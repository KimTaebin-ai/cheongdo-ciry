import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Bell, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, ExternalLink, Menu, MessageCircle, Plus, RotateCcw, Settings2, X, Zap } from 'lucide-react';
import type { Bill, Message, Notice, Rent, Reply } from './types';
import { dateKey, kindLabel, money, monthKey, nextDue, safePaymentUrl, statusText, transferText } from './domain';
import { DemoSession } from './demo';
import { LiveSession } from './live';
import { ApiError, KEPCO_URL, apiMode, fetchBills, fetchDemoShift, fetchNotifications } from './api';

const initial = () => new DemoSession();
const SEEN_KEY = 'gam-good-youth.seen-notices';
const readSeen = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set<string>(); } };
const writeSeen = (s: Set<string>) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200))); } catch { /* 저장할 수 없는 브라우저 환경 */ } };
const timeText = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(d); };

function Mascot({ className = '' }: { className?: string }) {
  return <svg className={`mascot ${className}`} viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M40 19C16 12 5 29 9 49c3 17 16 26 31 26s28-9 31-26C75 29 64 12 40 19Z" fill="#FF7A1A"/><path d="m40 25-15-11 16 3L52 8l-2 13 13 6-19 2-10 9 2-12-15-1 19-2Z" fill="#25221F"/><path d="M43 16V7" stroke="#25221F" strokeWidth="4" strokeLinecap="round"/><ellipse cx="28" cy="45" rx="2.5" ry="3.5" fill="#25221F"/><ellipse cx="52" cy="45" rx="2.5" ry="3.5" fill="#25221F"/><path d="M35 52q5 6 10 0" stroke="#25221F" strokeWidth="2.5" strokeLinecap="round"/><ellipse cx="21" cy="51" rx="5" ry="2.5" fill="#FFAA76"/><ellipse cx="59" cy="51" rx="5" ry="2.5" fill="#FFAA76"/></svg>;
}
function Button({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) { return <button className="action" onClick={onClick} disabled={disabled}>{children}</button>; }
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement; ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') { const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea, [tabindex="0"]'); if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [close]);
  return <div className="overlay" onClick={close}><div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e => e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={close}><X size={20}/></button></div>{children}</div></div>;
}

export default function App() {
  const [session, setSession] = useState(initial);
  const [live] = useState(() => apiMode ? new LiveSession() : null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState('');
  const [panel, setPanel] = useState<'menu' | 'calendar' | 'notifications' | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [consent, setConsent] = useState(() => live?.consent ?? false);
  const [toast, setToast] = useState('');
  const [fallbackCopy, setFallbackCopy] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(monthKey());
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(0);
  const [serverNotices, setServerNotices] = useState<Notice[]>([]);
  const [noticeError, setNoticeError] = useState('');
  const [demoShift, setDemoShift] = useState<number | null>(null);
  const [seen, setSeen] = useState(readSeen);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const locked = useRef(false);
  const announced = useRef(new Set<string>());

  const refreshServer = useCallback(async () => {
    if (!apiMode) return;
    const [billResult, noticeResult, shift] = await Promise.allSettled([fetchBills(), fetchNotifications(), fetchDemoShift()]);
    if (billResult.status === 'fulfilled') setBills(billResult.value);
    if (noticeResult.status === 'fulfilled') { setServerNotices(noticeResult.value); setNoticeError(''); }
    else setNoticeError(noticeResult.reason instanceof ApiError && noticeResult.reason.status === 404 ? '서버에 알림 API가 아직 연결되지 않았어요.' : '알림을 불러오지 못했어요. 서버 연결을 확인해 주세요.');
    if (shift.status === 'fulfilled') setDemoShift(shift.value);
    if (billResult.status === 'rejected') setError('서버의 등록 자료를 가져오지 못했어요. 백엔드 실행을 확인해 주세요.');
  }, []);

  useEffect(() => { const timer = setTimeout(() => setLoading(false), 450); return () => clearTimeout(timer); }, []);
  useEffect(() => { const el = scrollRef.current; el?.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, [messages, busy, stream]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const t = setInterval(() => setClock(c => c + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { void refreshServer(); }, [refreshServer, clock]);
  useEffect(() => {
    if (!apiMode) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshServer(); };
    document.addEventListener('visibilitychange', onVisible); window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [refreshServer]);

  void clock;
  const notices: Notice[] = apiMode ? serverNotices : session.dueNotifications();
  const unread = notices.filter(n => !seen.has(n.id));
  useEffect(() => {
    const fresh = unread.filter(n => !announced.current.has(n.id));
    fresh.forEach(n => announced.current.add(n.id));
    if (fresh.length) setToast(`새 알림 · ${fresh[0].message}`);
  }, [unread.map(n => n.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (panel !== 'notifications' || !unread.length) return;
    setSeen(old => { const next = new Set(old); notices.forEach(n => next.add(n.id)); writeSeen(next); return next; });
  }, [panel, unread.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const append = (reply: Reply) => {
    setMessages(old => [...old, { id: crypto.randomUUID(), role: 'assistant', text: reply.message, reply }]);
    if (reply.bill_cards) setBills(old => { const map = new Map(old.map(b => [b.id, b])); reply.bill_cards!.filter(b => !b.id.startsWith('proposal-')).forEach(b => map.set(b.id, b)); return [...map.values()]; });
  };
  const failure = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  async function send(text: string) {
    text = text.trim(); if (!text || locked.current) return;
    locked.current = true; setBusy(true); setError(''); setInput(''); setStream(''); setRetry(text);
    setMessages(old => [...old.map(m => m.reply?.pending_action ? { ...m, resolved: true } : m), { id: crypto.randomUUID(), role: 'user', text }]);
    try { append(live ? await live.send(text, d => setStream(s => s + d)) : session.send(text)); setRetry(''); }
    catch (e) { failure(e, '요청을 처리하지 못했어요.'); }
    finally { setBusy(false); locked.current = false; setStream(''); inputRef.current?.focus(); void refreshServer(); }
  }
  async function confirm(m: Message) {
    const action = m.reply?.pending_action; if (!action || locked.current || m.resolved) return;
    locked.current = true; setBusy(true); setError(''); setRetry('');
    try { append(live ? await live.confirm(action.id) : session.confirm(action.id)); setMessages(old => old.map(x => x.id === m.id ? { ...x, resolved: true } : x)); }
    catch (e) { failure(e, '변경을 적용하지 못했어요.'); }
    finally { setBusy(false); locked.current = false; void refreshServer(); }
  }
  async function copy(value: string) {
    try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(value); setToast('송금정보를 복사했어요. 송금은 은행 앱에서 직접 해 주세요.'); }
    catch { setFallbackCopy(value); }
  }
  async function allowReminders(enabled: boolean, fromChat = false) {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      if (live) { const r = await live.setConsent(enabled); setConsent(r.enabled); setToast(r.enabled ? `알림을 켰어요. 예약된 알림 ${r.reminders}건.` : '알림을 껐어요.'); }
      else { session.consent = enabled; session.remindersEnabled = enabled; setConsent(enabled); setToast(enabled ? '확인된 납부일의 알림을 예약했어요.' : '알림을 껐어요.'); }
      if (fromChat) append({ message: enabled ? '납부 3일 전·1일 전 오전 9시(한국 시간)에 웹 알림으로 알려드릴게요. 앱을 닫은 동안에는 푸시가 가지 않아요.' : '알림은 켜지 않았어요.', mode: 'real', via: live ? 'app' : 'demo' });
    } catch (e) { setToast(e instanceof Error ? `알림 설정을 저장하지 못했어요. ${e.message}` : '알림 설정을 저장하지 못했어요.'); }
    finally { setBusy(false); locked.current = false; void refreshServer(); }
  }
  function openKepco() {
    if (live) { void send('한전ON 열어줘'); return; }
    void send('전기요금 확인하고 싶어');
  }

  const close = useRef(() => setPanel(null)).current;
  const nextBill = nextDue(bills);
  const periodBills = bills.filter(b => b.period === calendarMonth);
  const [year, month] = calendarMonth.split('-').map(Number);
  const startDay = new Date(year, month - 1, 1).getDay();
  const dayCount = new Date(year, month, 0).getDate();
  function changeMonth(offset: number) { const d = new Date(year, month - 1 + offset, 1); setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  function reset() { if (busy) return; setMessages([]); setBills([]); setSession(initial()); setConsent(false); setPanel(null); setError(''); setDismissed(new Set()); setToast('데모 기록을 초기화했어요.'); }
  const sourceLabel = (s: Bill['source']) => s === 'sample' ? '합성 샘플' : s === 'manual' ? '직접 등록' : '서버 자료';
  const sourceNote = (s: Bill['source']) => s === 'sample' ? '합성 시연 자료' : s === 'manual' ? '사용자가 직접 입력한 정보' : '서버 등록 정보';

  function details(b: Bill) {
    return <><div className="card-label">{b.kind === 'rent' ? <CalendarDays size={17}/> : <Zap size={17}/>}<span>{b.period.replace('-', '년 ')}월 {kindLabel(b.kind)}</span><span className="source">{sourceLabel(b.source)}</span></div>
      <div className={`amount ${b.amount_krw === null ? 'unknown' : ''}`}>{money(b.amount_krw)}</div>
      <dl><div><dt>납부기한</dt><dd>{b.due_date ?? '미확인'}{b.due_date_adjusted ? ' · 말일로 조정' : ''}</dd></div><div><dt>납부상태</dt><dd>{statusText(b)}</dd></div>{b.status === 'pending' && b.reminder_enabled === false && <div><dt>알림</dt><dd>이 청구 알림 꺼짐</dd></div>}</dl></>;
  }
  function rentCard(r: Rent, m: Message) {
    const action = m.reply?.pending_action; const text = m.reply?.rent_transfer_text ?? transferText(r);
    const thisMonth = m.reply?.bill_cards?.find(b => b.kind === 'rent' && b.due_date);
    return <div className="bill-card"><div className="card-label"><CalendarDays size={17}/>월세 일정 · 계좌</div><div className="amount">{money(r.amount_krw)}</div>
      <dl><div><dt>납부일</dt><dd>매월 {r.due_day}일{r.due_day > 28 ? ' · 없는 날은 월말' : ''}</dd></div><div><dt>시작월</dt><dd>{r.start_month}</dd></div>{thisMonth && <div><dt>이번 납부일</dt><dd>{thisMonth.due_date}{thisMonth.status === 'user_confirmed' ? ' · 사용자 확인 완료' : ''}</dd></div>}<div><dt>은행</dt><dd>{r.bank}</dd></div><div><dt>계좌번호</dt><dd>{r.account_number}</dd></div><div><dt>예금주</dt><dd>{r.account_holder}</dd></div></dl>
      {action?.kind === 'rent'
        ? <Button disabled={busy || m.resolved} onClick={() => void confirm(m)}><Check size={16}/>{m.resolved ? '처리된 요청' : '확인하고 등록'}</Button>
        : <><pre className="transfer-text" aria-label="송금 안내 문구">{text}</pre><Button disabled={busy} onClick={() => void copy(text)}><Copy size={16}/>송금정보 복사</Button><span className="card-footnote">복사·안내 확인은 납부 완료가 아니에요. 송금 후 “월세 냈어”라고 알려주세요.</span></>}
    </div>;
  }
  function transferOnly(text: string) {
    return <div className="bill-card"><div className="card-label"><Copy size={17}/>월세 송금 안내</div><pre className="transfer-text" aria-label="송금 안내 문구">{text}</pre><Button disabled={busy} onClick={() => void copy(text)}><Copy size={16}/>송금정보 복사</Button></div>;
  }
  function viaNote(r: Reply) {
    if (r.via === 'agent') return <span className="via-note">서버 채팅 응답{r.tools?.length ? ` · 도구 ${[...new Set(r.tools)].join(', ')}` : ''}</span>;
    if (r.via === 'app') return <span className="via-note">앱 API로 처리</span>;
    return null;
  }

  if (loading) return <div className="splash" role="status"><Mascot/><strong>감좋은청년</strong><span>혼자 사는 일, 함께 챙겨요.</span><div className="loading-dots"><i/><i/><i/></div></div>;
  const modeText = apiMode ? '서버 연결 모드' : '프런트 데모 · AI 및 한전 자동 조회 없음';
  return <div className="app-layout">
    <aside className="sidebar"><div className="brand"><Mascot/><strong>감좋은청년</strong></div><p>나의 독립생활 도우미</p>
      <button className="side-item active" onClick={() => setPanel(null)}><MessageCircle size={18}/>생활비 대화</button>
      <button className="side-item" onClick={() => setPanel('calendar')}><CalendarDays size={18}/>납부 캘린더</button>
      <button className="side-item" onClick={() => setPanel('notifications')}><Bell size={18}/>알림 설정{unread.length > 0 && <span className="count-badge">{unread.length}</span>}</button>
      <div className="sidebar-bottom"><span className="mode-dot"/>{apiMode ? '백엔드 연결 모드' : '프런트 데모 모드'}<small>{apiMode ? '서버의 등록 자료를 사용해요. 한전 자동 조회는 없어요.' : 'AI·한전 자동 조회 없이 체험해요.'}</small><button className="text-button" onClick={() => setPanel('menu')}><Settings2 size={14}/>데모 설정</button></div>
    </aside>
    <main className="chat-shell">
      <header className="app-header"><button className="icon-button mobile-menu" aria-label="메뉴 열기" onClick={() => setPanel('menu')}><Menu size={21}/></button><div className="header-brand"><Mascot/><div><strong>감좋은청년</strong><span>나의 독립생활 도우미</span></div></div>
        <div className="header-actions"><button className="icon-button" aria-label="캘린더 열기" onClick={() => setPanel('calendar')}><CalendarDays size={21}/></button><button className="icon-button notice-button" aria-label={unread.length ? `알림 열기, 새 알림 ${unread.length}건` : '알림 열기'} onClick={() => setPanel('notifications')}><Bell size={21}/>{unread.length > 0 && <i/>}</button></div>
      </header>
      <div className="mode-strip"><span className="mode-dot"/>{modeText}{!!demoShift && <span className="demo-time">데모 시간 +{demoShift}시간</span>}<span className="today">{new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date())}</span></div>
      <div className="chat-scroll" ref={scrollRef}><div className="conversation">
        {messages.length === 0 ? <section className="welcome"><Mascot className="hero-mascot"/><p className="eyebrow">나의 첫 독립부터, 매달의 생활까지</p><h1>월세랑 전기요금,<br/>말하면 챙겨드려요.</h1><p className="welcome-copy">기억해야 할 일은 덜고,<br className="mobile-break"/> 나의 일상에 조금 더 집중하세요.</p>
          <div className="quick-actions"><Button onClick={() => void send('월세 일정과 계좌 등록할게')}><Plus size={16}/>월세 등록하기</Button><Button onClick={openKepco}><Zap size={16}/>한전ON 열기</Button></div>
          {nextBill ? <button className="upcoming" onClick={() => void send(nextBill.kind === 'rent' ? '월세 보낼 정보 알려줘' : '전기요금 알려줘')}><span>다가오는 {kindLabel(nextBill.kind)}{nextBill.source === 'sample' ? ' · 합성 샘플' : ''}<strong>{nextBill.due_date} · {money(nextBill.amount_krw)}</strong></span><ChevronRight size={20}/></button>
            : <div className="welcome-note"><div className="note-icon"><Bell size={19}/></div><div><strong>한 번 등록하면, 납부일에 맞춰</strong><span>동의한 일정에 웹 내 알림으로 챙겨드려요.</span></div><button className="text-button" onClick={() => setPanel('notifications')}>설정</button></div>}
        </section> : <>
          <div className="day-divider">오늘의 대화</div>
          <div role="log" aria-label="생활비 대화 내역" aria-live="polite" aria-relevant="additions">{messages.map(m => <article key={m.id} className={`message ${m.role}`}>{m.role === 'assistant' && <Mascot/>}<div className="message-body">
            <p className="message-text">{m.text}</p>
            {m.reply?.rent && rentCard(m.reply.rent, m)}
            {!m.reply?.rent && m.reply?.rent_transfer_text && transferOnly(m.reply.rent_transfer_text)}
            {m.reply?.connection && <div className="bill-card connection-card"><div className="connection-title"><span className="note-icon"><Zap size={21}/></span><strong>한국전력 한전ON</strong><ExternalLink size={17}/></div><p>공식 사이트에서 직접 조회·납부하세요.<br/>앱이 계정이나 청구정보를 자동으로 읽지 않아요.</p><a className="action" href={KEPCO_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>한전ON에서 조회·납부</a><Button disabled={busy} onClick={() => void send('전기요금 직접 등록할게')}>금액 · 납부일 직접 등록</Button></div>}
            {m.reply?.bill_cards?.filter(b => !(m.reply?.rent && b.kind === 'rent')).map(b => <div key={b.id} className="bill-card">{details(b)}
              {m.reply?.pending_action?.kind === 'electricity' || m.reply?.pending_action?.kind === 'proposal'
                ? <Button disabled={busy || m.resolved} onClick={() => void confirm(m)}><Check size={16}/>{m.resolved ? '처리된 요청' : '확인하고 등록'}</Button>
                : m.reply?.pending_action?.kind === 'paid'
                  ? <Button disabled={busy || m.resolved} onClick={() => void confirm(m)}><Check size={16}/>{m.resolved ? '처리된 요청' : '납부 기록하기'}</Button>
                  : <>{b.kind === 'electricity' && !m.reply?.connection && safePaymentUrl(b.payment_url) && <a className="action" href={safePaymentUrl(b.payment_url)!} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>한전ON에서 납부하기</a>}{b.status === 'pending' && b.amount_krw !== null && <button className="text-button paid-link" disabled={busy} onClick={() => void send(`${kindLabel(b.kind)} 납부했어`)}>납부했어요 <CheckCheck size={15}/></button>}</>}
              <span className="card-footnote">{sourceNote(b.source)}{b.checked_at && timeText(b.checked_at) ? ` · ${timeText(b.checked_at)}` : ''}</span></div>)}
            {m.reply?.pending_action?.kind === 'reminder' && <div className="bill-card"><div className="card-label"><Bell size={17}/>알림 변경</div><strong>납부 하루 전 {m.reply.pending_action.hour}시</strong><Button disabled={busy || m.resolved} onClick={() => void confirm(m)}>{m.resolved ? '처리된 요청' : '변경하기'}</Button></div>}
            {m.reply?.consent_prompt && !dismissed.has(m.id) && <div className="bill-card consent-card"><div className="card-label"><Bell size={17}/>납부 알림</div>{consent ? <p>알림 사용 중이에요. 확인된 납부일 3일 전·1일 전 오전 9시에 알려드려요.</p> : <><p>납부 3일 전·1일 전 오전 9시(한국 시간)에 웹 알림으로 알려드릴까요?<br/>한 번 동의하면 등록한 일정마다 자동으로 예약해요.</p><Button disabled={busy} onClick={() => void allowReminders(true, true)}><Bell size={16}/>알림 받을게요</Button><button className="text-button" disabled={busy} onClick={() => setDismissed(old => new Set(old).add(m.id))}>나중에 할게요</button></>}</div>}
            {m.reply?.pending_action && !m.resolved && <button className="text-button" disabled={busy} onClick={() => void send('취소')}>취소하기</button>}
            {m.role === 'assistant' && m.reply && viaNote(m.reply)}
          </div></article>)}</div>
        </>}
        {busy && <div className="message assistant"><Mascot/><div className="message-body"><p className="message-text" role="status">{stream || '말씀하신 내용을 확인하고 있어요'}{!stream && <span className="typing"><i/><i/><i/></span>}</p></div></div>}
        {error && <div className="error-box" role="alert"><strong>연결을 확인해 주세요</strong><p>{error}</p>{retry && <Button onClick={() => void send(retry)}><RotateCcw size={15}/>다시 시도</Button>}</div>}
      </div></div>
      <form className="composer-wrap" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(input); }}><div className="composer"><textarea ref={inputRef} value={input} maxLength={2000} rows={2} aria-label="메시지" placeholder="월세나 전기요금, 물어보세요" onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}/><div className="composer-bottom"><span><MessageCircle size={16}/>{apiMode ? '감좋은청년과 대화하기' : '예시 정보로 편하게 체험하세요'}</span><button className="send-button" type="submit" aria-label="메시지 보내기" disabled={busy || !input.trim()}><ArrowUp size={20}/></button></div></div><p className="composer-note">{apiMode ? '금액과 납부일은 등록된 정보를 확인해 주세요. 실제 송금·결제는 하지 않아요.' : '프런트 데모 · 새로고침하면 입력한 기록이 사라져요.'}</p></form>
    </main>
    {panel && <Modal title={panel === 'calendar' ? '납부 캘린더' : panel === 'notifications' ? '알림 설정' : '내 독립생활'} close={close}>{panel === 'calendar' ? <>
      <div className="month-control"><button className="icon-button" aria-label="이전 달" onClick={() => changeMonth(-1)}><ChevronLeft/></button><strong>{year}년 {month}월</strong><button className="icon-button" aria-label="다음 달" onClick={() => changeMonth(1)}><ChevronRight/></button></div>
      <div className="calendar-grid">{['일', '월', '화', '수', '목', '금', '토'].map(d => <span className="weekday" key={d}>{d}</span>)}{Array.from({ length: startDay }, (_, i) => <span key={`blank-${i}`}/>)}{Array.from({ length: dayCount }, (_, i) => { const key = `${calendarMonth}-${String(i + 1).padStart(2, '0')}`; return <button key={key} aria-label={`${key} 일정`} aria-pressed={selectedDate === key} className={`${selectedDate === key ? 'selected' : ''} ${key === dateKey() ? 'is-today' : ''}`} onClick={() => setSelectedDate(key)}>{i + 1}{periodBills.some(b => b.due_date === key) && <i/>}</button>; })}</div>
      <div className="date-detail"><h3>{selectedDate} 납부일</h3>{bills.filter(b => b.due_date === selectedDate).length ? bills.filter(b => b.due_date === selectedDate).map(b => <button className="calendar-bill" key={b.id} onClick={() => { close(); void send(b.kind === 'rent' ? '월세 정보 알려줘' : '전기요금 알려줘'); }}><span>{kindLabel(b.kind)}<small>{b.status === 'user_confirmed' ? '사용자 확인 완료' : '납부 확인 전'}{b.source === 'sample' ? ' · 합성 샘플' : ''}</small></span><strong>{money(b.amount_krw)}</strong><ChevronRight size={16}/></button>) : <p className="empty-text">등록된 납부 일정이 없어요.</p>}</div>
    </> : panel === 'notifications' ? <>
      <div className="notification-intro"><Bell/><h3>기억하는 수고를 덜어드릴게요.</h3><p>납부 3일 전 · 1일 전 오전 9시<br/>웹에 접속해 있을 때 확인하는 알림이에요.</p></div>
      <Button onClick={() => void allowReminders(!consent)} disabled={busy}>{consent ? '알림 끄기' : '동의하고 알림 켜기'}</Button>
      <p className="muted">{consent ? '알림 사용 중' : '알림 수신 동의 전'} · 앱 종료 중 OS 푸시는 보내지 않아요.{!!demoShift && <><br/><span className="demo-time">데모 시간 +{demoShift}시간 적용 중</span></>}</p>
      {noticeError && <p className="notice-error" role="alert">{noticeError}</p>}
      {notices.length > 0 ? notices.map(n => <div className="notification-item" key={n.id}><Bell size={18}/><div><strong>{n.message}</strong><p>{timeText(n.delivered_at ?? n.scheduled_at_utc)}{n.source === 'sample' ? ' · 합성 샘플' : ''}{n.demo_time_shift ? ' · 데모 시간' : ''}</p></div></div>) : !noticeError && <p className="empty-text">지금 도착한 알림이 없어요.</p>}
    </> : <>
      <div className="menu-brand"><Mascot/><h3>감좋은청년</h3><p>월세와 전기요금, 말하면 챙겨드려요.</p></div>
      <button className="menu-item" onClick={() => setPanel('calendar')}><CalendarDays/>납부 캘린더<ChevronRight/></button>
      <button className="menu-item" onClick={() => setPanel('notifications')}><Bell/>알림 설정<ChevronRight/></button>
      {!apiMode && <Button onClick={reset}><RotateCcw size={16}/>데모 기록 초기화</Button>}
      <p className="muted">{apiMode ? '백엔드 연결 모드 · 보호된 단일 데모 사용자' : '규칙 기반 프런트 데모 · 금융 자동 조회 없음'}<br/>실제 계좌 비밀번호·OTP는 입력하지 마세요.</p>
    </>}</Modal>}
    {fallbackCopy && <Modal title="송금정보 직접 복사" close={() => setFallbackCopy('')}><p className="muted">브라우저가 자동 복사를 허용하지 않았어요. 아래 내용을 선택해 복사해 주세요.</p><textarea className="copy-fallback" readOnly value={fallbackCopy} onFocus={e => e.target.select()} aria-label="복사할 송금정보"/></Modal>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}
