import type { Bill, Rent } from './types';
export const money = (n: number | null | undefined) => typeof n === 'number' ? `${n.toLocaleString('ko-KR')}원` : '금액 미확인';
export function dateKey(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
export function monthKey(d = new Date()) { return dateKey(d).slice(0, 7); }
export function dueDate(month: string, day: number) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
export function reminderDates(due: string, days = [3, 1], hour = 9, now = new Date()) {
  return days.map(day => new Date(new Date(`${due}T00:00:00+09:00`).getTime() - day * 86400000 + hour * 3600000)).filter(d => d > now).map(d => d.toISOString());
}
export function rentBill(r: Rent): Bill {
  const month = r.start_month > monthKey() ? r.start_month : monthKey(); return { id: `rent-${month}`, kind: 'rent', period: month, amount_krw: r.amount_krw, due_date: dueDate(month, r.due_day), autopay: false, status: 'pending', source: 'manual', checked_at: new Date().toISOString() };
}
export function transferText(r: Rent) { return `월세 송금 안내\n${money(r.amount_krw)} / 매월 ${r.due_day}일\n${r.bank} ${r.account_number}\n예금주: ${r.account_holder}`; }
export function parseRent(text: string, current: Partial<Rent> = {}): Partial<Rent> {
  const next = { ...current };
  const amount = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(만\s*원|원)/);
  if (amount) { const v = Number(amount[1]) * (/만/.test(amount[2]) ? 10000 : 1); if (Number.isSafeInteger(v) && v > 0 && v <= 100000000) next.amount_krw = v; }
  const day = text.match(/(?:매달|매월|납부일(?:은|을)?|월세일(?:은)?)\s*(\d{1,2})일/);
  if (day && Number(day[1]) >= 1 && Number(day[1]) <= 31) next.due_day = Number(day[1]);
  const bank = text.match(/([가-힣A-Za-z]+(?:은행|뱅크)|농협|수협|새마을금고|신협)/);
  if (bank) next.bank = bank[1];
  const account = text.match(/(?:계좌(?:번호)?\s*[:：]?\s*)?(\d{2,6}(?:-\d{2,8}){1,3})/);
  if (account) next.account_number = account[1];
  const holder = text.match(/예금주\s*[:：]?\s*([가-힣A-Za-z]{2,20})/);
  if (holder) next.account_holder = holder[1].replace(/(?:으로|로)$/,'');
  const start = text.match(/(20\d{2})[년.-]\s*(\d{1,2})월?/);
  next.start_month = start && Number(start[2]) >= 1 && Number(start[2]) <= 12 ? `${start[1]}-${start[2].padStart(2, '0')}` : next.start_month ?? monthKey();
  return next;
}
export function missingRent(r: Partial<Rent>) { return (['amount_krw', 'due_day', 'bank', 'account_number', 'account_holder'] as const).filter(k => !r[k]); }
export function safePaymentUrl(raw?: string | null) {
  if (!raw) return null;
  try { const u = new URL(raw); return u.protocol === 'https:' && ['online.kepco.co.kr', 'cyber.kepco.co.kr'].includes(u.hostname) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export const kindLabel = (kind: Bill['kind']) => kind === 'rent' ? '월세' : '전기요금';
/** 납부 확인 전 + 날짜 확정된 청구 중 가장 가까운 것. 날짜 없는 자료는 일정으로 쓰지 않는다. */
export function nextDue(bills: Bill[]) { return bills.filter(b => b.status === 'pending' && b.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0]; }
export function statusText(b: Bill, today = dateKey()) {
  if (b.status === 'user_confirmed') return '납부 기록 완료 · 사용자 확인';
  if (!b.due_date) return '납부기한 미확인 · 채팅으로 알려주세요';
  if (b.autopay) return '자동이체 출금 예정';
  if (b.due_date < today) return '기한 경과 · 납부 확인 필요';
  if (b.due_date === today) return '오늘 납부일 · 납부 확인 필요';
  return '납부 예정';
}
