import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, KEPCO_URL, normalizeBill, streamChat } from './api';
import { LiveSession } from './live';
import { dateKey } from './domain';
const START = dateKey().slice(0, 7);

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sseResponse = (blocks: string[]) => new Response(blocks.join(''), { headers: { 'content-type': 'text/event-stream' } });
const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
type Call = { url: string; method: string; body?: unknown };
function mockFetch(routes: Record<string, (c: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const c: Call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const handler = routes[`${c.method} ${url}`];
    return handler ? handler(c) : jsonResponse({ detail: 'not found' }, 404);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('bill normalization (C contract + B legacy)', () => {
  it('keeps missing amount/date as null and uses only the official KEPCO URL', () => {
    const b = normalizeBill({ id: 'electricity-2026-11', kind: 'electricity', period: '2026-11', amount_krw: null, due_date: null, source: 'sample', status: 'pending', payment_url: 'https://evil.example/' });
    expect(b).toMatchObject({ amount_krw: null, due_date: null, source: 'sample', payment_url: KEPCO_URL });
  });
  it('maps legacy paid_confirmed/sample fields and drops non-MVP kinds', () => {
    expect(normalizeBill({ id: 'b1', category: 'electricity', billing_month: '2026-11', amount_krw: 48320, due_date: '2026-11-25', status: 'paid_confirmed', source: { type: 'sample' }, is_sample: true })).toMatchObject({ status: 'user_confirmed', source: 'sample', period: '2026-11' });
    expect(normalizeBill({ id: 'g1', category: 'gas', billing_month: '2026-11', amount_krw: 1 })).toBeNull();
  });
  it('rejects malformed financial values instead of rendering them', () => {
    expect(() => normalizeBill({ id: 'x', kind: 'rent', period: '2026-11', amount_krw: -5, due_date: '2026-11-25', source: 'manual' })).toThrow(ApiError);
    expect(() => normalizeBill({ id: 'x', kind: 'rent', period: '2026-11', amount_krw: 5, due_date: '11/25', source: 'manual' })).toThrow(ApiError);
  });
});

describe('chat SSE', () => {
  it('collects tokens and tool calls from B events', async () => {
    mockFetch({ 'POST /api/chat': () => sseResponse([ev('tool_call', { name: 'list_bills' }), ev('tool_result', { name: 'list_bills', summary: '1건' }), ev('token', { text: '이번 달 ' }), ev('token', { text: '전기요금이에요.' }), ev('done', {})]) });
    const deltas: string[] = [];
    const out = await streamChat('전기요금 알려줘', d => deltas.push(d));
    expect(out).toMatchObject({ text: '이번 달 전기요금이에요.', tools: ['list_bills'], done: true });
    expect(deltas).toHaveLength(2);
  });
  it('surfaces server error events as failures, never as a fake answer', async () => {
    mockFetch({ 'POST /api/chat': () => sseResponse([ev('error', { kind: 'model', message: '모델 호출에 실패했어요' })]) });
    await expect(streamChat('안녕')).rejects.toThrow('모델 호출에 실패했어요');
  });
  it('treats a stream cut before done as a failure', async () => {
    mockFetch({ 'POST /api/chat': () => sseResponse([ev('token', { text: '중간' })]) });
    await expect(streamChat('안녕')).rejects.toThrow('끊겼');
  });
});

describe('live session routing', () => {
  it('asks for missing rent fields, saves only after confirm, and keeps the account string', async () => {
    const calls = mockFetch({
      'GET /api/rent': () => jsonResponse({ amount_krw: null, due_day: null, bank: null, account_number: null, account_holder: null, start_month: null }),
      'PUT /api/rent': c => jsonResponse({ rent: c.body, bills: [{ id: 'rent-2026-11', kind: 'rent', period: '2026-11', amount_krw: 450000, due_date: '2026-11-08', source: 'manual', status: 'pending' }], notice: null }),
      'GET /api/rent/transfer-text': () => jsonResponse({ rent_transfer_text: '월세 450,000원을 예시은행 000-123-456789 (예금주 김예시)로 송금해 주세요.' }),
    });
    const s = new LiveSession();
    expect((await s.send('월세 45만 원, 매달 8일로 등록해줘')).pending_action).toBeUndefined();
    const proposal = await s.send('예시은행 000-123-456789 예금주 김예시');
    expect(proposal.pending_action?.kind).toBe('rent');
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
    const saved = await s.confirm(proposal.pending_action!.id);
    const put = calls.find(c => c.method === 'PUT');
    expect(put?.body).toMatchObject({ amount_krw: 450000, due_day: 8, account_number: '000-123-456789', account_holder: '김예시' });
    expect(saved.rent_transfer_text).toContain('000-123-456789');
    expect(saved.bill_cards?.[0].due_date).toBe('2026-11-08');
    expect((await s.confirm(proposal.pending_action!.id)).message).toContain('만료');
  });
  it('records payment only after explicit confirmation via confirm-paid', async () => {
    const bill = { id: 'electricity-2026-11', kind: 'electricity', period: '2026-11', amount_krw: 48320, due_date: '2026-11-25', source: 'sample', status: 'pending' };
    const calls = mockFetch({
      'GET /api/bills': () => jsonResponse([bill]),
      'POST /api/bills/electricity-2026-11/confirm-paid': () => jsonResponse({ ...bill, status: 'user_confirmed' }),
    });
    const s = new LiveSession();
    const ask = await s.send('전기요금 납부했어');
    expect(ask.pending_action?.kind).toBe('paid');
    expect(calls.some(c => c.url.includes('confirm-paid'))).toBe(false);
    const done = await s.confirm(ask.pending_action!.id);
    expect(done.bill_cards?.[0].status).toBe('user_confirmed');
  });
  it('falls back to the official KEPCO link (not fake data) when the agent fails', async () => {
    mockFetch({ 'POST /api/chat': () => jsonResponse({ detail: 'down' }, 500), 'GET /api/bills': () => jsonResponse([]) });
    const r = await new LiveSession().send('전기요금 확인하고 싶어');
    expect(r).toMatchObject({ connection: true, via: 'app', bill_cards: [] });
    expect(r.message).toContain('AI 응답을 받지 못했어요');
  });
  it('rejects a server proposal whose numbers differ from what the user typed', async () => {
    mockFetch({ 'POST /api/chat': () => sseResponse([ev('proposal', { proposal_id: 'p1', bill: { category: 'electricity', billing_month: '2026-11', amount_krw: 99999, due_date: '2026-11-20' }, missing_fields: [] }), ev('done', {})]) });
    await expect(new LiveSession().send('전기요금 32,500원 2026-11-20 등록해줘')).rejects.toThrow('달라');
  });
  it('registers rent through the agent save_rent proposal when its values match', async () => {
    let chatBody: unknown;
    const calls = mockFetch({
      'GET /api/rent': () => jsonResponse({ amount_krw: null, due_day: null, bank: null, account_number: null, account_holder: null, start_month: null }),
      'POST /api/chat': c => { chatBody = c.body; return sseResponse([
        ev('tool_call', { name: 'save_rent', arguments: { proposal_only: true } }),
        ev('proposal', { proposal_id: 'r1', action: 'save_rent', payload: { amount_krw: 450000, due_day: 8, bank: '예시은행', account_number: '000-123-456789', account_holder: '김예시', start_month: START }, missing_fields: [] }),
        ev('done', { message: '확인 후 저장할 수 있습니다.', mode: 'sample' })]); },
      'POST /api/proposals/r1/confirm': () => jsonResponse({ rent: {}, bills: [{ id: 'rent-2026-11', kind: 'rent', period: '2026-11', amount_krw: 450000, due_date: '2026-11-08', source: 'manual', status: 'pending' }], notice: null, created: true, duplicate: false }),
      'GET /api/rent/transfer-text': () => jsonResponse({ rent_transfer_text: '월세 450,000원을 예시은행 000-123-456789 (예금주 김예시)로 송금해 주세요.' }),
    });
    const s = new LiveSession();
    await s.send('월세 45만 원, 매달 8일로 등록해줘');
    const ask = await s.send('예시은행 000-123-456789 예금주 김예시');
    expect(ask).toMatchObject({ via: 'agent', tools: ['save_rent'] });
    expect(String((chatBody as { message: string }).message)).toContain('계좌: 000-123-456789');
    const saved = await s.confirm(ask.pending_action!.id);
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
    expect(calls.some(c => c.url === '/api/proposals/r1/confirm')).toBe(true);
    expect(saved.bill_cards?.[0].due_date).toBe('2026-11-08');
  });
  it('records payment through the agent confirm_paid proposal, falling back to REST when the agent fails', async () => {
    const bill = { id: 'electricity-2026-11', kind: 'electricity', period: '2026-11', amount_krw: 48320, due_date: '2026-11-25', source: 'sample', status: 'pending' };
    const calls = mockFetch({
      'GET /api/bills': () => jsonResponse([bill]),
      'POST /api/chat': () => sseResponse([ev('tool_call', { name: 'confirm_paid' }), ev('proposal', { proposal_id: 'k1', action: 'confirm_paid', payload: { bill_id: bill.id }, missing_fields: [] }), ev('done', { message: '', mode: 'sample' })]),
      'POST /api/proposals/k1/confirm': () => jsonResponse({ bill: { ...bill, status: 'user_confirmed' }, created: true, duplicate: false }),
    });
    const s = new LiveSession();
    const ask = await s.send('전기요금 납부했어');
    expect(ask).toMatchObject({ via: 'agent', tools: ['confirm_paid'] });
    expect(calls.some(c => c.url.includes('confirm-paid'))).toBe(false);
    expect((await s.confirm(ask.pending_action!.id)).bill_cards?.[0].status).toBe('user_confirmed');
    expect(calls.some(c => c.url.includes('confirm-paid'))).toBe(false);
  });
  it('turns reminders off through the agent set_reminder_enabled tool', async () => {
    const calls = mockFetch({
      'POST /api/chat': () => sseResponse([ev('tool_call', { name: 'set_reminder_enabled' }), ev('proposal', { proposal_id: 'n1', action: 'set_reminder_enabled', payload: { enabled: false, bill_id: null }, missing_fields: [] }), ev('done', { message: '', mode: 'sample' })]),
      'POST /api/proposals/n1/confirm': () => jsonResponse({ enabled: false, bill_id: null, created: true, duplicate: false }),
    });
    const r = await new LiveSession().send('알림 꺼줘');
    expect(r).toMatchObject({ via: 'agent', tools: ['set_reminder_enabled'] });
    expect(calls.some(c => c.url === '/api/reminder-settings')).toBe(false);
  });
});
