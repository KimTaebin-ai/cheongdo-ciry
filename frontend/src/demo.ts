import type { Action, Bill, Rent, Reply } from './types';
import { dateKey, dueDate, missingRent, monthKey, parseRent, rentBill, transferText } from './domain';

/** Deterministic UI simulator, NOT an AI agent or a real KEPCO adapter. No disk storage. */
export class DemoSession {
  rent?: Rent;
  draft?: Partial<Rent>;
  bills: Bill[] = [];
  consent = false;
  remindersEnabled = true;
  hour = 9;
  days = [3, 1];
  connected = false;
  electricDraft?: { amount?: number; due?: string };
  pending = new Map<string, Action>();
  reply(message: string, extra: Partial<Reply> = {}): Reply { return { message, mode: 'sample', ...extra }; }
  propose(message: string, action: Omit<Action, 'id'>, extra: Partial<Reply> = {}) {
    this.pending.clear();
    const next = { ...action, id: crypto.randomUUID() };
    this.pending.set(next.id, next);
    return this.reply(message, { pending_action: next, ...extra });
  }
  confirm(id: string): Reply {
    const a = this.pending.get(id); this.pending.delete(id);
    if (!a) return this.reply('이미 처리했거나 만료된 요청이에요. 다시 말씀해 주세요.');
    if (a.kind === 'rent' && a.rent) {
      this.rent = a.rent; this.draft = undefined;
      const b = rentBill(a.rent); this.bills = [...this.bills.filter(x => x.id !== b.id), b];
      return this.reply('월세 일정과 계좌를 등록했어요.', { rent: a.rent, bill_cards: [b] });
    }
    if (a.kind === 'electricity' && a.bill) {
      this.electricDraft = undefined;
      this.bills = [...this.bills.filter(b => b.id !== a.bill!.id), a.bill];
      return this.reply('입력한 전기요금 정보를 등록했어요. 한전 자동 조회 결과가 아니에요.', { bill_cards: [{ ...a.bill }] });
    }
    if (a.kind === 'paid') {
      const b = this.bills.find(x => x.id === a.bill_id);
      if (!b) return this.reply('해당 청구를 다시 확인해 주세요.');
      b.status = 'user_confirmed';
      return this.reply('사용자 확인으로 납부 기록을 남겼어요. 이 청구의 남은 알림은 중지했어요.', { bill_cards: [{ ...b }] });
    }
    if (a.kind === 'reminder') {
      this.hour = a.hour ?? 9; this.days = a.days ?? [1]; this.remindersEnabled = true;
      return this.reply(`알림을 납부 ${this.days.join('일 전·')}일 전 ${this.hour}시로 바꿨어요. 이전 예약은 대체했어요.`);
    }
    return this.reply('요청을 처리하지 못했어요. 다시 말씀해 주세요.');
  }
  send(text: string): Reply {
    if (/취소|그만/.test(text)) { this.draft = undefined; this.electricDraft = undefined; this.pending.clear(); return this.reply('진행 중인 요청을 취소했어요.'); }
    if (this.electricDraft || (/전기/.test(text) && /등록|기억|알려줄/.test(text))) {
      const draft = this.electricDraft ?? {};
      const amount = text.replace(/,/g, '').match(/(\d+)\s*원/); if (amount && Number(amount[1]) > 0 && Number(amount[1]) <= 100000000) draft.amount = Number(amount[1]);
      const date = text.match(/(20\d{2})-(\d{2})-(\d{2})/) ?? text.match(/(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일/);
      if (date) {
        const y = date[1] ?? dateKey().slice(0,4); const m = Number(date[2]); const d = Number(date[3]);
        const value = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (m >= 1 && m <= 12 && d >= 1 && dueDate(`${y}-${String(m).padStart(2,'0')}`, d) === value) draft.due = value;
        else return this.reply('달력에 없는 날짜예요. 납부기한을 다시 알려주세요.');
      }
      this.electricDraft = draft;
      if (!draft.amount || !draft.due) return this.reply(`전기요금 ${!draft.amount ? '금액(예: 32,500원)' : ''}${!draft.amount && !draft.due ? '과 ' : ''}${!draft.due ? '납부기한(예: 2026-11-20)' : ''}을 알려주세요. 한전에서 확인한 정보를 직접 입력해 주세요.`);
      const b: Bill = { id: `electricity-${draft.due.slice(0,7)}`, kind: 'electricity', period: draft.due.slice(0,7), amount_krw: draft.amount, due_date: draft.due, source: 'manual', checked_at: new Date().toISOString(), autopay: null, status: 'pending', payment_url: 'https://online.kepco.co.kr/' };
      return this.propose('직접 입력한 이 정보로 등록할까요?', { kind: 'electricity', bill: b }, { bill_cards: [b] });
    }
    if (this.draft || (/월세|계좌/.test(text) && /등록|수정|바꿔|변경/.test(text))) {
      this.draft = parseRent(text, this.draft ?? this.rent);
      const missing = missingRent(this.draft);
      if (missing.length) {
        const labels = { amount_krw: '월세 금액(예: 45만 원)', due_day: '매월 납부일(예: 매달 8일)', bank: '은행 이름', account_number: '계좌번호(하이픈 포함)', account_holder: '예금주 이름(예: 예금주 김예시)' };
        return this.reply(`등록에 필요한 ${missing.map(k => labels[k]).join(', ')}을 알려주세요.\n실제 정보 대신 합성 예시를 사용해도 돼요.`);
      }
      const r = this.draft as Rent;
      const shortMonth = Number(dueDate(r.start_month, r.due_day).slice(-2)) !== r.due_day;
      return this.propose(`월세 정보를 확인해 주세요.${shortMonth || r.due_day > 28 ? '\n지정일이 없는 달은 그 달의 마지막 날로 안내할게요.' : ''}`, { kind: 'rent', rent: { ...r } }, { rent: { ...r } });
    }
    if (/알림/.test(text)) {
      if (/꺼|해제|중지|끄기/.test(text)) { this.remindersEnabled = false; return this.reply('웹 내 납부 알림을 껐어요. 다시 켜려면 “알림 켜줘”라고 해 주세요.'); }
      if (/켜|동의/.test(text)) { this.consent = true; this.remindersEnabled = true; return this.reply('확인된 납부일에 3일 전·1일 전 오전 9시 웹 내 알림을 예약할게요.'); }
      const h = text.match(/(오전|오후|저녁)?\s*(\d{1,2})시/);
      if (h) {
        let hour = Number(h[2]); if (hour < 1 || hour > 23 || (h[1] && hour > 12)) return this.reply('알림 시각은 0~23시 범위로 알려주세요.');
        if (/오후|저녁/.test(h[1] ?? '') && hour < 12) hour += 12;
        if (h[1] === '오전' && hour === 12) hour = 0;
        return this.propose(`납부 하루 전 ${hour}시로 알림을 바꿀까요?`, { kind: 'reminder', hour, days: [1] });
      }
      return this.reply(this.consent ? `현재 알림: 납부 ${this.days.join('일 전·')}일 전 ${this.hour}시. “알림을 전날 저녁 7시로 바꿔줘”처럼 말해 보세요.` : '먼저 상단 알림 메뉴에서 수신에 동의해 주세요. 앱을 닫은 동안 OS 푸시는 보내지 않아요.');
    }
    if (/냈|납부했|납부 완료|송금했/.test(text)) {
      const kind = /월세/.test(text) ? 'rent' : /전기/.test(text) ? 'electricity' : undefined;
      const candidates = this.bills.filter(b => b.status === 'pending' && (!kind || b.kind === kind));
      if (candidates.length !== 1) return this.reply(candidates.length ? '월세와 전기요금 중 어떤 것을 납부했나요?' : '납부를 확인할 청구가 없어요. 먼저 월세를 등록하거나 전기요금을 조회해 주세요.');
      return this.propose('이 청구를 사용자 확인으로 납부 기록할까요?', { kind: 'paid', bill_id: candidates[0].id }, { bill_cards: [{ ...candidates[0] }] });
    }
    if (/월세|송금|계좌/.test(text)) return this.rent ? this.reply('월세 보낼 때 이 정보를 쓰세요.', { rent: { ...this.rent }, rent_transfer_text: transferText(this.rent), bill_cards: this.bills.filter(b => b.kind === 'rent').map(b => ({ ...b })) }) : this.reply('아직 월세가 등록되지 않았어요. “월세 45만 원, 매달 8일로 등록해줘”라고 시작해 보세요.');
    if (/샘플/.test(text)) {
      this.connected = true;
      const period = monthKey(); const existing = this.bills.find(b => b.id === `electricity-${period}`);
      const b: Bill = existing ?? { id: `electricity-${period}`, kind: 'electricity', period, amount_krw: 32500, due_date: dueDate(period, 20), autopay: false, status: 'pending', source: 'sample', checked_at: new Date().toISOString(), payment_url: 'https://online.kepco.co.kr/' };
      if (!existing) this.bills.push(b);
      return this.reply('UI 시연용 합성 청구예요. 한전 조회 결과가 아니에요.', { bill_cards: [{ ...b }] });
    }
    if (/전기|한전/.test(text)) {
      const bills = this.bills.filter(b => b.kind === 'electricity');
      return this.reply('한전ON 공식 사이트에서 직접 조회·납부할 수 있어요. 금액과 납부기한을 알려주면 여기에도 등록해 드릴게요.', { connection: true, bill_cards: bills.map(b => ({ ...b })) });
    }
    if (/달력|캘린더|날짜/.test(text)) return this.reply('상단 캘린더에서 날짜별 납부일을 확인할 수 있어요.');
    return this.reply('월세 등록·수정, 송금정보 확인, 한전 전기요금 샘플 조회와 알림 설정을 도와드려요.\n이 화면은 규칙 기반 프런트 데모예요. 자유로운 AI 대화는 백엔드 연결 후 사용할 수 있어요.');
  }
  dueNotifications() {
    if (!this.consent || !this.remindersEnabled) return [];
    const today = dateKey();
    return this.bills.filter(b => b.status === 'pending').filter(b => {
      const diff = Math.round((new Date(`${b.due_date}T00:00:00+09:00`).getTime() - new Date(`${today}T00:00:00+09:00`).getTime()) / 86400000);
      const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Seoul' }).format(new Date()));
      return (this.days.includes(diff) && hour >= this.hour) || diff <= 0;
    });
  }
}
