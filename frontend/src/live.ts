import type { Action, Bill, Rent, Reply } from './types';
import { ApiError, confirmPaid, confirmProposal, fetchBills, fetchRent, fetchTransferText, normalizeBill, saveRent, setReminderConsent, streamChat, type ChatOutcome } from './api';
import { dateKey, dueDate, kindLabel, missingRent, parseRent } from './domain';

/**
 * 서버 연결 모드의 대화 라우터.
 * - 월세 등록·송금 안내·납부 확인·알림 켜기/끄기: 먼저 /api/chat 에이전트에 보내 서버 도구(save_rent·rent_transfer_text·
 *   confirm_paid·set_reminder_enabled)를 쓰게 한다. 도구 제안 값이 화면 값과 같을 때만 그 제안으로 확인·저장한다(via='agent').
 *   에이전트가 실패·시간 초과·다른 값을 내면 앱 REST API로 직접 처리한다(via='app').
 * - 전기요금 직접 등록: 입력값을 정리해 /api/chat 제안 흐름으로 보내고, 사용자 확인 후 저장한다.
 * - 그 밖의 질문: /api/chat 에이전트(B) 응답. via='agent'.
 * 서버 실패를 데모 응답으로 바꾸지 않는다. 금액·날짜는 서버 응답 또는 사용자가 입력한 값만 쓴다.
 */
const CONSENT_KEY = 'gam-good-youth.reminder-consent';
const readConsent = () => { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; } };
const writeConsent = (v: boolean) => { try { localStorage.setItem(CONSENT_KEY, v ? '1' : '0'); } catch { /* 저장할 수 없는 브라우저 환경 */ } };
const RENT_LABELS = { amount_krw: '월세 금액(예: 45만 원)', due_day: '매월 납부일(예: 매달 8일)', bank: '은행 이름', account_number: '계좌번호(하이픈 포함)', account_holder: '예금주 이름(예: 예금주 김예시)' } as const;
const modeOf = (cards: Bill[] = []): Reply['mode'] => cards.some(b => b.source === 'sample') ? 'sample' : 'real';
/** 도구 의도(등록·납부·알림)는 에이전트를 오래 기다리지 않고 앱 API로 넘어간다. */
/** 도구성 요청은 서버 규칙 경로가 바로 답한다. 모델로 넘어가 늦어지면 기다리지 않고 앱 API로 처리한다. */
const AGENT_TOOL_TIMEOUT = 8000;
const rentMessage = (r: Rent) => `월세 등록\n월세 ${r.amount_krw}원\n매달 ${r.due_day}일\n${r.bank}\n계좌: ${r.account_number}\n예금주: ${r.account_holder}`;
const sameRent = (p: Record<string, unknown>, r: Rent) =>
  (['amount_krw', 'due_day', 'bank', 'account_number', 'account_holder', 'start_month'] as const).every(k => p[k] === r[k]);

export function parseElectric(text: string, draft: { amount?: number; due?: string } = {}) {
  const next = { ...draft };
  const amount = text.replace(/,/g, '').match(/(\d+)\s*원/);
  if (amount && Number(amount[1]) > 0 && Number(amount[1]) <= 100000000) next.amount = Number(amount[1]);
  const date = text.match(/(20\d{2})-(\d{2})-(\d{2})/) ?? text.match(/(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일/);
  if (date) {
    const y = date[1] ?? dateKey().slice(0, 4); const m = Number(date[2]); const d = Number(date[3]);
    const month = `${y}-${String(m).padStart(2, '0')}`; const value = `${month}-${String(d).padStart(2, '0')}`;
    if (m < 1 || m > 12 || d < 1 || dueDate(month, d) !== value) return { draft: next, invalidDate: true };
    next.due = value;
  }
  return { draft: next, invalidDate: false };
}

export class LiveSession {
  draft?: Partial<Rent>;
  electricDraft?: { amount?: number; due?: string };
  consent = readConsent();
  pending = new Map<string, Action>();

  private app(message: string, extra: Partial<Reply> = {}): Reply { return { message, mode: modeOf(extra.bill_cards), via: 'app', ...extra }; }
  private propose(message: string, action: Omit<Action, 'id'> & { id?: string }, extra: Partial<Reply> = {}, via: Reply['via'] = 'app') {
    this.pending.clear();
    const next: Action = { ...action, id: action.id ?? crypto.randomUUID() };
    this.pending.set(next.id, next);
    return { ...this.app(message, { pending_action: next, ...extra }), via };
  }
  /** 에이전트 호출. 실패는 null로 돌려 앱 API 경로로 넘긴다(가짜 응답 없음). */
  private async agentTool(message: string): Promise<ChatOutcome | null> {
    try { return await streamChat(message, undefined, AGENT_TOOL_TIMEOUT); } catch { return null; }
  }
  private async billsOf(kind?: Bill['kind']) { try { return (await fetchBills()).filter(b => !kind || b.kind === kind); } catch { return []; } }

  /** 사용자가 직접 켜기/끄기를 말했으므로 에이전트의 set_reminder_enabled 제안을 바로 확인한다. 실패하면 null. */
  private async consentViaAgent(enabled: boolean): Promise<string[] | null> {
    const outcome = await this.agentTool(`웹 납부 알림 전체를 ${enabled ? '켜' : '꺼'} 주세요. set_reminder_enabled 도구로 enabled=${enabled}, bill_id 없이 제안을 만들어 주세요.`);
    const p = outcome?.proposal;
    if (!outcome || p?.action !== 'set_reminder_enabled' || p.payload.enabled !== enabled || (p.payload.bill_id ?? null) !== null) return null;
    try { await confirmProposal(p.id); } catch { return null; }
    this.consent = enabled; writeConsent(enabled);
    return outcome.tools;
  }

  async setConsent(enabled: boolean) {
    const r = await setReminderConsent(enabled);
    this.consent = r.enabled; writeConsent(r.enabled);
    return r;
  }

  async confirm(id: string): Promise<Reply> {
    const a = this.pending.get(id);
    if (!a) return this.app('이미 처리했거나 만료된 요청이에요. 다시 말씀해 주세요.');
    let reply: Reply;
    if (a.kind === 'rent' && a.rent) {
      const { bills, notice } = a.proposal_id ? await confirmProposal(a.proposal_id) : await saveRent(a.rent);
      this.draft = undefined;
      const transfer = await fetchTransferText().catch(() => null);
      reply = this.app(`월세 일정과 계좌를 등록했어요.${notice ? `\n${notice}` : ''}`, { rent: a.rent, rent_transfer_text: transfer, bill_cards: bills.filter(b => b.kind === 'rent').slice(0, 1), consent_prompt: !this.consent });
    } else if (a.kind === 'paid' && a.bill_id) {
      const bill = a.proposal_id ? (await confirmProposal(a.proposal_id)).bill : await confirmPaid(a.bill_id);
      if (!bill) throw new ApiError('납부 기록 응답 형식이 맞지 않아요.');
      reply = this.app('사용자 확인으로 납부 기록을 남겼어요. 이 청구의 남은 알림은 중지했어요.', { bill_cards: [bill] });
    } else if (a.kind === 'proposal') {
      const { bill, duplicate } = await confirmProposal(a.id);
      this.electricDraft = undefined;
      reply = bill
        ? this.app(`${duplicate ? '이미 등록된 정보예요.' : '입력한 전기요금 정보를 등록했어요.'} 한전 자동 조회 결과가 아니에요.`, { bill_cards: [bill], consent_prompt: !this.consent })
        : this.app('저장했어요. 이번 버전 화면은 전기요금·월세만 카드로 보여줘요.');
    } else {
      reply = this.app('요청을 처리하지 못했어요. 다시 말씀해 주세요.');
    }
    this.pending.delete(id);
    return reply;
  }

  async send(text: string, onDelta?: (s: string) => void): Promise<Reply> {
    if (/^(취소|그만)/.test(text.trim()) || /취소(해|할게)/.test(text)) { this.draft = undefined; this.electricDraft = undefined; this.pending.clear(); return this.app('진행 중인 요청을 취소했어요.'); }

    if (/한전\s*on|한전온/i.test(text) && !/등록|입력/.test(text)) {
      const cards = await this.billsOf('electricity');
      return this.app('한전ON 공식 사이트에서 직접 조회·납부할 수 있어요. 금액과 납부기한을 알려주면 여기에도 등록해 드릴게요.', { connection: true, bill_cards: cards });
    }

    if (this.draft || (/월세|계좌/.test(text) && /등록|수정|바꿔|변경/.test(text))) {
      const base = this.draft ?? await fetchRent().catch(() => ({}));
      this.draft = parseRent(text, base);
      const missing = missingRent(this.draft);
      if (missing.length) return this.app(`등록에 필요한 ${missing.map(k => RENT_LABELS[k]).join(', ')}을 알려주세요.\n실제 정보 대신 합성 예시를 사용해도 돼요.`);
      const r = this.draft as Rent;
      const shortMonth = dueDate(r.start_month, r.due_day).slice(-2) !== String(r.due_day).padStart(2, '0');
      const ask = `월세 정보를 확인해 주세요.${shortMonth || r.due_day > 28 ? '\n지정일이 없는 달은 그 달의 마지막 날로 안내할게요.' : ''}`;
      const outcome = await this.agentTool(rentMessage(r));
      const p = outcome?.proposal;
      if (outcome && p?.action === 'save_rent' && !p.missing.length && sameRent(p.payload, r))
        return this.propose(ask, { id: p.id, proposal_id: p.id, kind: 'rent', rent: { ...r } }, { rent: { ...r }, tools: outcome.tools }, 'agent');
      return this.propose(ask, { kind: 'rent', rent: { ...r } }, { rent: { ...r } });
    }

    if (this.electricDraft || (/전기/.test(text) && /등록|기억|입력/.test(text))) {
      const { draft, invalidDate } = parseElectric(text, this.electricDraft);
      this.electricDraft = draft;
      if (invalidDate) return this.app('달력에 없는 날짜예요. 납부기한을 다시 알려주세요.');
      if (!draft.amount || !draft.due) return this.app(`전기요금 ${!draft.amount ? '금액(예: 32,500원)' : ''}${!draft.amount && !draft.due ? '과 ' : ''}${!draft.due ? '납부기한(예: 2026-11-20)' : ''}을 알려주세요. 한전ON에서 확인한 정보를 직접 입력해 주세요.`);
      const period = draft.due.slice(0, 7);
      const outcome = await streamChat(`한국전력공사 전기요금 직접 입력\n청구월: ${period}\n청구금액: ${draft.amount}원\n납부기한: ${draft.due}`);
      if (!outcome.proposal?.bill) throw new ApiError('서버에 전기요금 직접 등록 기능이 아직 연결되지 않았어요.');
      const card = normalizeBill({ ...outcome.proposal.bill, id: `proposal-${outcome.proposal.id}`, source: 'manual', status: 'pending', payment_url: null });
      if (!card || card.amount_krw !== draft.amount || card.due_date !== draft.due) throw new ApiError('서버가 정리한 값이 입력한 금액·날짜와 달라 등록을 멈췄어요. 다시 입력해 주세요.');
      return this.propose('직접 입력한 이 정보로 등록할까요?', { id: outcome.proposal.id, kind: 'proposal', bill: card }, { bill_cards: [card], tools: outcome.tools }, 'agent');
    }

    if (/냈|납부했|납부 완료|송금했/.test(text)) {
      const kind = /월세/.test(text) ? 'rent' : /전기/.test(text) ? 'electricity' : undefined;
      const candidates = (await fetchBills()).filter(b => b.status === 'pending' && (!kind || b.kind === kind));
      const ordered = candidates.filter(b => b.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
      if (!kind && new Set(candidates.map(b => b.kind)).size > 1) return this.app('월세와 전기요금 중 어떤 것을 납부했나요?');
      if (!ordered.length) return this.app('납부를 확인할 청구가 없어요. 먼저 월세나 전기요금을 등록해 주세요.');
      const target = ordered[0];
      const ask = `${target.period.replace('-', '년 ')}월 ${kindLabel(target.kind)}을 사용자 확인으로 납부 기록할까요?`;
      const outcome = await this.agentTool(`납부 확인 요청: bill_id=${target.id} (${target.period} ${kindLabel(target.kind)}). confirm_paid 도구로 이 청구의 납부 확인 제안을 만들어 주세요.`);
      const p = outcome?.proposal;
      if (outcome && p?.action === 'confirm_paid' && p.payload.bill_id === target.id)
        return this.propose(ask, { id: p.id, proposal_id: p.id, kind: 'paid', bill_id: target.id }, { bill_cards: [target], tools: outcome.tools }, 'agent');
      return this.propose(ask, { kind: 'paid', bill_id: target.id }, { bill_cards: [target] });
    }

    if (/알림/.test(text) && /꺼|해제|중지|끄기|그만/.test(text)) {
      const tools = await this.consentViaAgent(false);
      if (!tools) await this.setConsent(false);
      return { ...this.app('웹 내 납부 알림을 껐어요. 다시 켜려면 “알림 켜줘”라고 해 주세요.'), ...(tools ? { via: 'agent' as const, tools } : {}) };
    }
    if (/알림/.test(text) && /켜|동의|받을/.test(text)) {
      const tools = await this.consentViaAgent(true);
      if (tools) return { ...this.app('납부 3일 전·1일 전 오전 9시(한국 시간) 웹 알림을 켰어요.'), via: 'agent', tools };
      const r = await this.setConsent(true); return this.app(`납부 3일 전·1일 전 오전 9시(한국 시간) 웹 알림을 켰어요. 지금 예약된 알림 ${r.reminders}건.`);
    }
    if (/알림/.test(text) && /\d+\s*시|시간|바꿔|변경/.test(text)) return this.app('지금은 납부 3일 전·1일 전 오전 9시 알림만 지원해요. 끄려면 “알림 꺼줘”라고 해 주세요.');

    if (/월세|송금|계좌/.test(text)) {
      const rentRequest = fetchRent(); const cardsRequest = this.billsOf('rent');
      rentRequest.catch(() => undefined);
      const outcome = await this.agentTool('월세 송금 안내 보여줘');
      const agentText = typeof outcome?.final?.rent_transfer_text === 'string' ? outcome.final.rent_transfer_text : null;
      const [transfer, rent, cards] = await Promise.all([agentText ? Promise.resolve(agentText) : fetchTransferText(), rentRequest, cardsRequest]);
      if (!transfer) return this.app('아직 월세가 등록되지 않았어요. “월세 45만 원, 매달 8일로 등록해줘”라고 시작해 보세요.');
      const reply = this.app('월세 보낼 때 이 정보를 쓰세요. 복사해도 납부 완료로 기록하지 않아요.', { rent: missingRent(rent).length ? undefined : rent as Rent, rent_transfer_text: transfer, bill_cards: cards });
      return agentText && outcome ? { ...reply, via: 'agent', tools: outcome.tools } : reply;
    }

    const kind = /월세/.test(text) ? 'rent' : /전기|한전/.test(text) ? 'electricity' : undefined;
    try {
      const outcome = await streamChat(text, onDelta);
      if (outcome.result) return { ...outcome.result, tools: outcome.tools, connection: outcome.result.connection ?? kind === 'electricity' };
      const cards = kind ? await this.billsOf(kind) : [];
      return { message: outcome.text.trim() || '응답 내용이 비어 있어요. 다시 물어봐 주세요.', mode: modeOf(cards), via: 'agent', tools: outcome.tools, bill_cards: cards, connection: kind === 'electricity' };
    } catch (e) {
      if (kind !== 'electricity') throw e;
      const cards = await this.billsOf('electricity');
      return this.app(`AI 응답을 받지 못했어요. (${e instanceof Error ? e.message : '연결 실패'})\n한전ON 공식 사이트는 바로 열 수 있어요.`, { connection: true, bill_cards: cards });
    }
  }
}
