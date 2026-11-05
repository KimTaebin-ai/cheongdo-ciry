import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Bell, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, ExternalLink, Menu, MessageCircle, Plus, RotateCcw, Settings2, X, Zap } from 'lucide-react';
import type { Bill, Message, Rent, Reply } from './types';
import { dateKey, dueDate, money, monthKey, reminderDates, safePaymentUrl, transferText } from './domain';
import { DemoSession } from './demo';
import { apiMode, registeredBills, requestReply } from './api';

const initial = () => new DemoSession();
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
      if (e.key === 'Tab') { const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, [tabindex="0"]'); if (!nodes?.length) return; const first=nodes[0], last=nodes[nodes.length-1]; if (e.shiftKey && (document.activeElement===first || document.activeElement===ref.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown',key); return () => { document.removeEventListener('keydown',key); previous?.focus(); };
  }, [close]);
  return <div className="overlay" onClick={close}><div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={close}><X size={20}/></button></div>{children}</div></div>;
}

export default function App() {
  const [session, setSession] = useState(initial);
  const [messages,setMessages] = useState<Message[]>([]);
  const [input,setInput] = useState('');
  const [busy,setBusy] = useState(false);
  const [stream,setStream] = useState('');
  const [error,setError] = useState('');
  const [retry,setRetry] = useState('');
  const [panel,setPanel] = useState<'menu'|'calendar'|'notifications'|null>(null);
  const [bills,setBills] = useState<Bill[]>([]);
  const [consent,setConsent] = useState(false);
  const [toast,setToast] = useState('');
  const [fallbackCopy,setFallbackCopy] = useState('');
  const [calendarMonth,setCalendarMonth] = useState(monthKey());
  const [selectedDate,setSelectedDate] = useState(dateKey());
  const [loading,setLoading] = useState(true);
  const [clock,setClock] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const locked = useRef(false);
  useEffect(()=>{ const timer=setTimeout(()=>setLoading(false),450); return ()=>clearTimeout(timer); },[]);
  useEffect(()=>{ const el=scrollRef.current; el?.scrollTo({top:el.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); },[messages,busy,stream]);
  useEffect(()=>{if (!toast) return; const t=setTimeout(()=>setToast(''),3000);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{const t=setInterval(()=>setClock(c=>c+1),30000);return()=>clearInterval(t);},[]);
  useEffect(()=>{if(!apiMode)return;let active=true;registeredBills().then(data=>{if(active)setBills(data);}).catch(()=>{if(active)setError('서버의 등록 자료를 가져오지 못했어요. 백엔드 실행을 확인해 주세요.');});return()=>{active=false;};},[]);
  void clock;
  const append = (reply: Reply) => {
    setMessages(old=>[...old,{id:crypto.randomUUID(),role:'assistant',text:reply.message,reply}]);
    if (reply.bill_cards) setBills(old=>{ const map=new Map(old.map(b=>[b.id,b])); reply.bill_cards!.forEach(b=>map.set(b.id,b)); return [...map.values()]; });
  };
  async function send(text: string) {
    text=text.trim();if (!text || locked.current) return;
    locked.current=true;setBusy(true);setError('');setInput('');setStream('');setRetry(text);
    setMessages(old=>[...old.map(m=>m.reply?.pending_action?{...m,resolved:true}:m),{id:crypto.randomUUID(),role:'user',text}]);
    try { if (apiMode) append(await requestReply('/api/chat',{message:text},d=>setStream(s=>s+d))); else append(session.send(text)); }
    catch(e) { setError(e instanceof Error?e.message:'요청을 처리하지 못했어요.'); }
    finally {setBusy(false);locked.current=false;setStream('');inputRef.current?.focus();}
  }
  async function confirm(m: Message) {
    const action=m.reply?.pending_action;if(!action||locked.current||m.resolved)return;
    locked.current=true;setBusy(true);setError('');setRetry('');
    try { append(apiMode?await requestReply(`/api/actions/${encodeURIComponent(action.id)}/confirm`,{}):session.confirm(action.id));setMessages(old=>old.map(x=>x.id===m.id?{...x,resolved:true}:x)); }
    catch(e){setError(e instanceof Error?e.message:'변경을 적용하지 못했어요.');}
    finally{setBusy(false);locked.current=false;}
  }
  async function copy(value:string) {
    try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(value);setToast('송금정보를 복사했어요.'); }
    catch{setFallbackCopy(value);}
  }
  async function allowReminders(enabled:boolean) {
    if(busy)return;
    if(apiMode) { try {append(await requestReply('/api/reminder-settings',{enabled,days_before:[3,1],hour:9,timezone:'Asia/Seoul'}));setConsent(enabled);}catch{setToast('알림 설정을 저장하지 못했어요.');} }
    else {session.consent=enabled;session.remindersEnabled=enabled;setConsent(enabled);setToast(enabled?'확인된 납부일의 알림을 예약했어요.':'알림을 껐어요.');}
  }
  const close = useRef(()=>setPanel(null)).current;
  const pendingBills=bills.filter(b=>b.status==='pending');
  const nextBill=[...pendingBills].sort((a,b)=>a.due_date.localeCompare(b.due_date))[0];
  const notices=apiMode?[]:session.dueNotifications();
  const periodBills=bills.filter(b=>b.period===calendarMonth);
  const [year,month]=calendarMonth.split('-').map(Number);
  const startDay=new Date(year,month-1,1).getDay();
  const dayCount=new Date(year,month,0).getDate();
  function changeMonth(offset:number){const d=new Date(year,month-1+offset,1);setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}
  function reset(){if(busy)return;setMessages([]);setBills([]);setSession(initial());setConsent(false);setPanel(null);setError('');setToast('데모 기록을 초기화했어요.');}
  function details(b:Bill) {return <><div className="card-label">{b.kind==='rent'?<CalendarDays size={17}/>:<Zap size={17}/>}<span>{b.period.replace('-','년 ')}월 {b.kind==='rent'?'월세':'전기요금'}</span><span className="source">{b.source==='sample'?'합성 샘플':b.source==='manual'?'직접 등록':'서버 자료'}</span></div><div className="amount">{money(b.amount_krw)}</div><dl><div><dt>납부기한</dt><dd>{b.due_date}</dd></div><div><dt>납부상태</dt><dd>{b.status==='user_confirmed'?'납부 기록 완료 · 사용자 확인':b.autopay?'자동이체 예정':b.due_date<dateKey()?'기한 경과 · 납부 확인 필요':'납부 예정'}</dd></div></dl></>;}
  function rentCard(r:Rent,m:Message) { const action=m.reply?.pending_action;return <div className="bill-card"><div className="card-label"><CalendarDays size={17}/>월세 일정 · 계좌</div><div className="amount">{money(r.amount_krw)}</div><dl><div><dt>납부일</dt><dd>매월 {r.due_day}일{r.due_day>28?' · 없는 날은 월말':''}</dd></div><div><dt>시작월</dt><dd>{r.start_month}</dd></div><div><dt>은행</dt><dd>{r.bank}</dd></div><div><dt>계좌번호</dt><dd>{r.account_number}</dd></div><div><dt>예금주</dt><dd>{r.account_holder}</dd></div></dl>{action?.kind==='rent'?<Button disabled={busy||m.resolved} onClick={()=>void confirm(m)}><Check size={16}/>{m.resolved?'처리된 요청':'확인하고 등록'}</Button>:<Button disabled={busy} onClick={()=>void copy(m.reply?.rent_transfer_text??transferText(r))}><Copy size={16}/>송금정보 복사</Button>}</div>; }
  if(loading) return <div className="splash" role="status"><Mascot/><strong>감좋은청년</strong><span>혼자 사는 일, 함께 챙겨요.</span><div className="loading-dots"><i/><i/><i/></div></div>;
  return <div className="app-layout"><aside className="sidebar"><div className="brand"><Mascot/><strong>감좋은청년</strong></div><p>나의 독립생활 도우미</p><button className="side-item active" onClick={()=>setPanel(null)}><MessageCircle size={18}/>생활비 대화</button><button className="side-item" onClick={()=>setPanel('calendar')}><CalendarDays size={18}/>납부 캘린더</button><button className="side-item" onClick={()=>setPanel('notifications')}><Bell size={18}/>알림 설정</button><div className="sidebar-bottom"><span className="mode-dot"/>{apiMode?'백엔드 연결 모드':'프런트 데모 모드'}<small>{apiMode?'서버의 등록 자료를 사용해요.':'AI·한전 자동 조회 없이 체험해요.'}</small><button className="text-button" onClick={()=>setPanel('menu')}><Settings2 size={14}/>데모 설정</button></div></aside>
  <main className="chat-shell"><header className="app-header"><button className="icon-button mobile-menu" aria-label="메뉴 열기" onClick={()=>setPanel('menu')}><Menu size={21}/></button><div className="header-brand"><Mascot/><div><strong>감좋은청년</strong><span>나의 독립생활 도우미</span></div></div><div className="header-actions"><button className="icon-button" aria-label="캘린더 열기" onClick={()=>setPanel('calendar')}><CalendarDays size={21}/></button><button className="icon-button notice-button" aria-label="알림 열기" onClick={()=>setPanel('notifications')}><Bell size={21}/>{notices.length>0&&<i/>}</button></div></header>
  <div className="mode-strip"><span className="mode-dot"/>{apiMode?'서버 연결 모드':'프런트 데모 · AI 및 한전 자동 조회 없음'}<span className="today">{new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',timeZone:'Asia/Seoul'}).format(new Date())}</span></div>
  <div className="chat-scroll" ref={scrollRef}><div className="conversation">
  {messages.length===0?<section className="welcome"><Mascot className="hero-mascot"/><p className="eyebrow">나의 첫 독립부터, 매달의 생활까지</p><h1>월세랑 전기요금,<br/>말하면 챙겨드려요.</h1><p className="welcome-copy">기억해야 할 일은 덜고,<br className="mobile-break"/> 나의 일상에 조금 더 집중하세요.</p><div className="quick-actions"><Button onClick={()=>void send('월세 일정과 계좌 등록할게')}><Plus size={16}/>월세 등록하기</Button><Button onClick={()=>void send('전기요금 확인하고 싶어')}><Zap size={16}/>한전ON 열기</Button></div>{nextBill?<button className="upcoming" onClick={()=>void send(nextBill.kind==='rent'?'월세 보낼 정보 알려줘':'전기요금 알려줘')}><span>다가오는 {nextBill.kind==='rent'?'월세':'전기요금'}<strong>{nextBill.due_date} · {money(nextBill.amount_krw)}</strong></span><ChevronRight size={20}/></button>:<div className="welcome-note"><div className="note-icon"><Bell size={19}/></div><div><strong>한 번 등록하면, 납부일에 맞춰</strong><span>동의한 일정에 웹 내 알림으로 챙겨드려요.</span></div><button className="text-button" onClick={()=>setPanel('notifications')}>설정</button></div>}</section>:<>
  <div className="day-divider">오늘의 대화</div><div role="log" aria-label="생활비 대화 내역" aria-live="polite" aria-relevant="additions">{messages.map(m=><article key={m.id} className={`message ${m.role}`}>{m.role==='assistant'&&<Mascot/>}<div className="message-body"><p className="message-text">{m.text}</p>{m.reply?.rent&&rentCard(m.reply.rent,m)}{m.reply?.connection&&<div className="bill-card connection-card"><div className="connection-title"><span className="note-icon"><Zap size={21}/></span><strong>한국전력 한전ON</strong><ExternalLink size={17}/></div><p>공식 사이트에서 직접 조회·납부하세요.<br/>앱이 계정이나 청구정보를 자동으로 읽지 않아요.</p><a className="action" href="https://online.kepco.co.kr/" target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>한전ON에서 조회·납부</a><Button disabled={busy} onClick={()=>void send('전기요금 직접 등록할게')}>금액 · 납부일 직접 등록</Button></div>}
  {m.reply?.bill_cards?.filter(b=>!(m.reply?.rent&&b.kind==='rent')).map(b=><div key={b.id} className="bill-card">{details(b)}{m.reply?.pending_action?.kind==='electricity'?<Button disabled={busy||m.resolved} onClick={()=>void confirm(m)}><Check size={16}/>{m.resolved?'처리된 요청':'확인하고 등록'}</Button>:m.reply?.pending_action?.kind==='paid'?<Button disabled={busy||m.resolved} onClick={()=>void confirm(m)}><Check size={16}/>{m.resolved?'처리된 요청':'납부 기록하기'}</Button>:<>{b.kind==='electricity'&&safePaymentUrl(b.payment_url)&&<a className="action" href={safePaymentUrl(b.payment_url)!} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>한전ON에서 납부하기</a>}{b.status==='pending'&&<button className="text-button paid-link" disabled={busy} onClick={()=>void send(`${b.kind==='rent'?'월세':'전기요금'} 납부했어`)}>납부했어요 <CheckCheck size={15}/></button>}</>}<span className="card-footnote">{b.source==='sample'?'합성 시연 자료':b.source==='manual'?'사용자가 직접 입력한 정보':'서버 등록 정보'} · {new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}).format(new Date(b.checked_at))}</span></div>)}
  {m.reply?.pending_action?.kind==='reminder'&&<div className="bill-card"><div className="card-label"><Bell size={17}/>알림 변경</div><strong>납부 하루 전 {m.reply.pending_action.hour}시</strong><Button disabled={busy||m.resolved} onClick={()=>void confirm(m)}>{m.resolved?'처리된 요청':'변경하기'}</Button></div>}{m.reply?.pending_action&&!m.resolved&&<button className="text-button" disabled={busy} onClick={()=>void send('취소')}>취소하기</button>}</div></article>)}</div>
  </>}
  {busy&&<div className="message assistant"><Mascot/><div className="message-body"><p className="message-text" role="status">{stream||'말씀하신 내용을 확인하고 있어요'}{!stream&&<span className="typing"><i/><i/><i/></span>}</p></div></div>}
  {error&&<div className="error-box" role="alert"><strong>연결을 확인해 주세요</strong><p>{error}</p>{retry&&<Button onClick={()=>void send(retry)}><RotateCcw size={15}/>다시 시도</Button>}</div>}
  </div></div>
  <form className="composer-wrap" onSubmit={(e:FormEvent)=>{e.preventDefault();void send(input);}}><div className="composer"><textarea ref={inputRef} value={input} maxLength={2000} rows={2} aria-label="메시지" placeholder="월세나 전기요금, 물어보세요" onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send(input);}}}/><div className="composer-bottom"><span><MessageCircle size={16}/>{apiMode?'감좋은청년과 대화하기':'예시 정보로 편하게 체험하세요'}</span><button className="send-button" type="submit" aria-label="메시지 보내기" disabled={busy||!input.trim()}><ArrowUp size={20}/></button></div></div><p className="composer-note">{apiMode?'금액과 납부일은 등록된 정보를 확인해 주세요.':'프런트 데모 · 새로고침하면 입력한 기록이 사라져요.'}</p></form>
  </main>
  {panel&&<Modal title={panel==='calendar'?'납부 캘린더':panel==='notifications'?'알림 설정':'내 독립생활'} close={close}>{panel==='calendar'?<><div className="month-control"><button className="icon-button" aria-label="이전 달" onClick={()=>changeMonth(-1)}><ChevronLeft/></button><strong>{year}년 {month}월</strong><button className="icon-button" aria-label="다음 달" onClick={()=>changeMonth(1)}><ChevronRight/></button></div><div className="calendar-grid">{['일','월','화','수','목','금','토'].map(d=><span className="weekday" key={d}>{d}</span>)}{Array.from({length:startDay},(_,i)=><span key={`blank-${i}`}/>)}{Array.from({length:dayCount},(_,i)=>{const key=`${calendarMonth}-${String(i+1).padStart(2,'0')}`;return <button key={key} aria-label={`${key} 일정`} aria-pressed={selectedDate===key} className={`${selectedDate===key?'selected':''} ${key===dateKey()?'is-today':''}`} onClick={()=>setSelectedDate(key)}>{i+1}{periodBills.some(b=>b.due_date===key)&&<i/>}</button>;})}</div><div className="date-detail"><h3>{selectedDate} 납부일</h3>{bills.filter(b=>b.due_date===selectedDate).length?bills.filter(b=>b.due_date===selectedDate).map(b=><button className="calendar-bill" key={b.id} onClick={()=>{close();void send(b.kind==='rent'?'월세 정보 알려줘':'전기요금 알려줘');}}><span>{b.kind==='rent'?'월세':'전기요금'}<small>{b.status==='user_confirmed'?'사용자 확인 완료':'납부 확인 전'}</small></span><strong>{money(b.amount_krw)}</strong><ChevronRight size={16}/></button>):<p className="empty-text">등록된 납부 일정이 없어요.</p>}</div></>:panel==='notifications'?<><div className="notification-intro"><Bell/><h3>기억하는 수고를 덜어드릴게요.</h3><p>납부 3일 전 · 1일 전 오전 9시<br/>웹에 접속해 있을 때 확인하는 알림이에요.</p></div><Button onClick={()=>void allowReminders(!consent)} disabled={busy}>{consent?'알림 끄기':'동의하고 알림 켜기'}</Button><p className="muted">{consent?'알림 사용 중':'알림 수신 동의 전'} · 앱 종료 중 OS 푸시는 보내지 않아요.</p>{notices.length>0?notices.map(b=><div className="notification-item" key={b.id}><Bell size={18}/><div><strong>{b.kind==='rent'?'월세':'전기요금'} 납부 확인이 필요해요</strong><p>{b.due_date} · {money(b.amount_krw)}</p></div></div>):<p className="empty-text">지금 도착한 알림이 없어요.</p>}</>:<><div className="menu-brand"><Mascot/><h3>감좋은청년</h3><p>월세와 전기요금, 말하면 챙겨드려요.</p></div><button className="menu-item" onClick={()=>setPanel('calendar')}><CalendarDays/>납부 캘린더<ChevronRight/></button><button className="menu-item" onClick={()=>setPanel('notifications')}><Bell/>알림 설정<ChevronRight/></button>{!apiMode&&<Button onClick={reset}><RotateCcw size={16}/>데모 기록 초기화</Button>}<p className="muted">{apiMode?'백엔드 연결 모드':'규칙 기반 프런트 데모 · 금융 자동 조회 없음'}<br/>실제 계좌 비밀번호·OTP는 입력하지 마세요.</p></>}</Modal>}
  {fallbackCopy&&<Modal title="송금정보 직접 복사" close={()=>setFallbackCopy('')}><p className="muted">브라우저가 자동 복사를 허용하지 않았어요. 아래 내용을 선택해 복사해 주세요.</p><textarea className="copy-fallback" readOnly value={fallbackCopy} onFocus={e=>e.target.select()} aria-label="복사할 송금정보"/></Modal>}
  {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}
