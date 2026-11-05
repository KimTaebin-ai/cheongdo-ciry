import type { Bill, Notice, Rent, Reply } from './types';
import { safePaymentUrl } from './domain';

/**
 * 백엔드 API 어댑터.
 * - REST: C(backend/app/main.py) 계약 — /api/bills, /api/notifications, /api/reminder-settings, /api/rent, /api/rent/transfer-text, /api/bills/{id}/confirm-paid, /health
 * - Chat: B(backend/api/app.py) 계약 — POST /api/chat SSE(token/tool_call/tool_result/proposal/done/error), POST /api/proposals/{id}/confirm
 * 실패를 데모 응답으로 대체하지 않는다. 서버 값은 검증한 뒤에만 카드로 쓴다.
 */
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const apiMode = import.meta.env.VITE_APP_MODE === 'api';
export const KEPCO_URL = 'https://online.kepco.co.kr/';
export const sessionId = crypto.randomUUID();

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

function statusMessage(status: number, detail?: string) {
  if (status === 401) return '인증이 만료됐어요. 데모 서버 접속 정보를 확인해 주세요.';
  if (status === 404) return detail && detail !== 'Not Found' ? `요청한 자료를 찾지 못했어요. (${detail})` : '요청한 기능이나 자료를 서버에서 찾지 못했어요.';
  if (status === 405) return '서버에 이 기능이 아직 연결되지 않았어요.';
  if (status === 409) return detail ?? '정보가 부족해 처리하지 못했어요.';
  if (status === 410) return '확인 시간이 지났어요. 다시 요청해 주세요.';
  if (status === 422) return '필수 정보가 부족하거나 형식이 맞지 않아요. 채팅으로 다시 알려주세요.';
  if (status === 429) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
  return '서버 요청에 실패했어요. 잠시 후 다시 시도해 주세요.';
}

async function detailOf(response: Response) {
  try { const body = await response.json(); return typeof body?.detail === 'string' ? body.detail : undefined; } catch { return undefined; }
}

async function open(path: string, init: RequestInit = {}, timeout = 15000) {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      credentials: 'same-origin', ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new ApiError(e instanceof DOMException && e.name === 'TimeoutError' ? '서버 응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.' : '서버에 연결하지 못했어요. 네트워크나 백엔드 실행을 확인해 주세요.');
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, await detailOf(response)), response.status);
  return response;
}

async function json<T>(path: string, init: RequestInit = {}, timeout?: number): Promise<T> {
  const response = await open(path, init, timeout);
  try { return await response.json() as T; } catch { throw new ApiError('서버 응답 형식이 맞지 않아요.'); }
}

/** C 계약 Bill과 B 레거시 Bill(category/billing_month/source 객체)을 하나의 Bill로 맞춘다. 전기·월세 외 항목은 null. */
export function normalizeBill(value: unknown): Bill | null {
  if (!isObject(value)) throw new ApiError('청구 데이터 검증에 실패했어요.');
  const kind = value.kind ?? value.category;
  if (kind !== 'electricity' && kind !== 'rent') return null;
  const due = value.due_date ?? null;
  const period = value.period ?? value.billing_month ?? (typeof due === 'string' ? due.slice(0, 7) : null);
  const amount = value.amount_krw ?? null;
  const legacySourceType = isObject(value.source) ? value.source.type : undefined;
  const source = typeof value.source === 'string' ? value.source : value.is_sample === true || legacySourceType === 'sample' ? 'sample' : 'manual';
  const knownStatus = ['pending', 'user_confirmed', 'paid_confirmed', 'scheduled', 'needs_review', 'overdue_unconfirmed'];
  const valid = typeof value.id === 'string' && value.id.length > 0
    && typeof period === 'string' && MONTH.test(period)
    && (amount === null || (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0))
    && (due === null || (typeof due === 'string' && DATE.test(due)))
    && ['real', 'sample', 'manual'].includes(source as string)
    && (value.status === undefined || knownStatus.includes(value.status as string));
  if (!valid) throw new ApiError('청구 데이터 검증에 실패했어요.');
  return {
    id: value.id as string, kind, period: period as string,
    amount_krw: amount as number | null, due_date: due as string | null,
    autopay: typeof value.autopay === 'boolean' ? value.autopay : null,
    status: value.status === 'user_confirmed' || value.status === 'paid_confirmed' ? 'user_confirmed' : 'pending',
    source: source as Bill['source'],
    checked_at: typeof value.checked_at === 'string' ? value.checked_at : null,
    payment_url: kind === 'electricity' ? (safePaymentUrl(value.payment_url as string | null) ?? KEPCO_URL) : null,
    reminder_enabled: value.reminder_enabled !== false,
    due_date_adjusted: value.due_date_adjusted === true,
  };
}

const billsOf = (data: unknown) => {
  if (!Array.isArray(data)) throw new ApiError('청구 목록 응답 형식이 맞지 않아요.');
  return data.map(normalizeBill).filter((b): b is Bill => b !== null);
};

export const fetchBills = async () => billsOf(await json<unknown>('/api/bills'));

export async function fetchNotifications(): Promise<Notice[]> {
  const data = await json<unknown>('/api/notifications');
  if (!Array.isArray(data)) throw new ApiError('알림 응답 형식이 맞지 않아요.');
  return data.filter((n): n is Notice => isObject(n) && typeof n.id === 'string' && typeof n.bill_id === 'string' && typeof n.message === 'string' && typeof n.scheduled_at_utc === 'string')
    .map(n => ({ ...n, source: ['real', 'sample', 'manual'].includes(n.source) ? n.source : 'manual', demo_time_shift: n.demo_time_shift === true }));
}

/** /health는 인증 없이 열려 있다. 실패해도 화면을 막지 않는다. */
export async function fetchDemoShift(): Promise<number | null> {
  try { const h = await json<Raw>('/health', {}, 5000); return typeof h.demo_time_shift_hours === 'number' ? h.demo_time_shift_hours : 0; } catch { return null; }
}

export async function setReminderConsent(enabled: boolean) {
  const r = await json<Raw>('/api/reminder-settings', { method: 'POST', body: JSON.stringify({ enabled }) });
  return { enabled: r.enabled === true, reminders: Array.isArray(r.reminders) ? r.reminders.filter(x => isObject(x) && (x.state ?? 'pending') === 'pending').length : 0 };
}

export async function fetchRent(): Promise<Partial<Rent>> {
  const r = await json<Raw>('/api/rent');
  const out: Partial<Rent> = {};
  if (typeof r.amount_krw === 'number') out.amount_krw = r.amount_krw;
  if (typeof r.due_day === 'number') out.due_day = r.due_day;
  for (const k of ['bank', 'account_number', 'account_holder', 'start_month'] as const) if (typeof r[k] === 'string' && r[k]) out[k] = r[k] as string;
  return out;
}

export async function saveRent(rent: Rent) {
  const r = await json<Raw>('/api/rent', { method: 'PUT', body: JSON.stringify(rent) });
  return { bills: billsOf(r.bills ?? []), notice: typeof r.notice === 'string' ? r.notice : null };
}

export async function fetchTransferText(): Promise<string | null> {
  try { const r = await json<Raw>('/api/rent/transfer-text'); return typeof r.rent_transfer_text === 'string' ? r.rent_transfer_text : null; }
  catch (e) { if (e instanceof ApiError && e.status === 409) return null; throw e; }
}

export async function confirmPaid(billId: string) {
  const bill = normalizeBill(await json<unknown>(`/api/bills/${encodeURIComponent(billId)}/confirm-paid`, { method: 'POST' }));
  if (!bill) throw new ApiError('납부 기록 응답 형식이 맞지 않아요.');
  return bill;
}

export async function confirmProposal(proposalId: string) {
  const r = await json<Raw>(`/api/proposals/${encodeURIComponent(proposalId)}/confirm`, { method: 'POST', body: JSON.stringify({ session_id: sessionId }) });
  return { bill: normalizeBill(r.bill), duplicate: r.duplicate === true };
}

export type ChatProposal = { id: string; bill: Raw; missing: string[] };
export type ChatOutcome = { text: string; tools: string[]; proposal?: ChatProposal; result?: Reply; done: boolean };

function validateReply(value: unknown): Reply {
  if (!isObject(value) || typeof value.message !== 'string' || !['real', 'sample'].includes(value.mode as string)) throw new ApiError('서버 응답 형식이 맞지 않아요.');
  return { ...(value as unknown as Reply), bill_cards: value.bill_cards === undefined ? undefined : billsOf(value.bill_cards), via: 'agent' };
}

/** POST /api/chat. SSE 이벤트를 읽어 텍스트·도구 호출·제안을 모은다. error 이벤트는 그대로 실패로 보여준다. */
export async function streamChat(message: string, onDelta?: (s: string) => void): Promise<ChatOutcome> {
  let response: Response;
  try { response = await open('/api/chat', { method: 'POST', headers: { Accept: 'text/event-stream, application/json' }, body: JSON.stringify({ session_id: sessionId, message }) }, 75000); }
  catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 405)) throw new ApiError('서버에 AI 채팅 기능이 아직 연결되지 않았어요.', e.status); throw e; }
  const out: ChatOutcome = { text: '', tools: [], done: false };
  if (!response.headers.get('content-type')?.includes('text/event-stream')) { out.result = validateReply(await response.json().catch(() => null)); out.done = true; return out; }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('응답 스트림이 없어요.');
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (block: string) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const raw = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!raw || raw === '[DONE]') { if (event === 'done') out.done = true; return; }
    let data: Raw;
    try { data = JSON.parse(raw); } catch { throw new ApiError('응답 형식이 맞지 않아요.'); }
    const type = event ?? (typeof data.type === 'string' ? data.type : '');
    if (type === 'token' || type === 'text_delta') { const d = String(data.text ?? data.delta ?? ''); out.text += d; onDelta?.(d); }
    else if (type === 'tool_call') { if (typeof data.name === 'string') out.tools.push(data.name); }
    else if (type === 'proposal') { if (typeof data.proposal_id === 'string' && isObject(data.bill)) out.proposal = { id: data.proposal_id, bill: data.bill, missing: Array.isArray(data.missing_fields) ? data.missing_fields.map(String) : [] }; }
    else if (type === 'result') { out.result = validateReply(data.data ?? data); }
    else if (type === 'done') { out.done = true; }
    else if (type === 'error') { throw new ApiError(typeof data.message === 'string' ? data.message : '에이전트 처리에 실패했어요.'); }
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) { handle(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
    if (done) break;
  }
  if (buffer.trim()) handle(buffer);
  if (!out.done && !out.result) throw new ApiError('응답이 중간에 끊겼어요. 다시 시도해 주세요.');
  return out;
}
