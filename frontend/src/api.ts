import type { Bill, Reply } from './types';
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const apiMode = import.meta.env.VITE_APP_MODE === 'api';
const sessionId = crypto.randomUUID();
type LegacyBill = { id: string; category: string; billing_month: string; amount_krw: number; due_date: string; autopay: boolean; status: string; source: {type: string}; is_sample: boolean };
export async function registeredBills(): Promise<Bill[]> {
  const response=await fetch(`${base}/api/bills`,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error('등록된 청구를 읽지 못했어요.');
  const data=await response.json();if(!Array.isArray(data)) throw new Error('청구 목록 응답 형식이 맞지 않아요.');
  return data.filter((b:LegacyBill&Bill)=>['electricity','rent'].includes(b.kind??b.category)).map((b:LegacyBill&Bill)=> {
    if(b.kind) return validateReply({message:'',mode:'real',bill_cards:[b]}).bill_cards![0];
    const result:Bill={id:b.id,kind:b.category as Bill['kind'],period:b.billing_month,amount_krw:b.amount_krw,due_date:b.due_date,autopay:b.autopay,status:b.status==='paid_confirmed'?'user_confirmed':'pending',source:b.is_sample?'sample':'manual',checked_at:new Date().toISOString(),payment_url:b.category==='electricity'?'https://online.kepco.co.kr/':null};
    return validateReply({message:'',mode:result.source==='sample'?'sample':'real',bill_cards:[result]}).bill_cards![0];
  });
}
function validateReply(value: unknown): Reply {
  const r = value as Reply;
  if (!r || typeof r.message !== 'string' || !['real', 'sample'].includes(r.mode)) throw new Error('서버 응답 형식이 맞지 않아요.');
  if (r.bill_cards && (!Array.isArray(r.bill_cards) || r.bill_cards.some((b: Bill) => !b || !Number.isSafeInteger(b.amount_krw) || b.amount_krw < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date) || !['electricity','rent'].includes(b.kind) || !['pending','user_confirmed'].includes(b.status) || !['real','sample','manual'].includes(b.source)))) throw new Error('청구 데이터 검증에 실패했어요.');
  return r;
}
export async function requestReply(path: string, body: unknown, onDelta?: (s: string) => void): Promise<Reply> {
  const payload=path==='/api/chat'?{...(body as object),session_id:sessionId}:body;
  const response = await fetch(`${base}${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(response.status === 401 ? '인증이 만료됐어요. 데모 서버 연결을 확인해 주세요.' : '서버 요청에 실패했어요. 잠시 후 다시 시도해 주세요.');
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return validateReply(await response.json());
  const reader = response.body?.getReader(); if (!reader) throw new Error('응답 스트림이 없어요.');
  const decoder = new TextDecoder(); let buffer = ''; let result: Reply | undefined;let accumulated='';let legacyDone=false;
  function process(block: string) {
    const event = block.match(/^event:\s*(.+)$/m)?.[1];
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const value = JSON.parse(data);
    if (event === 'text_delta' || value.type === 'text_delta'||event==='token') {const delta=value.delta??value.text??'';accumulated+=delta;onDelta?.(delta);}
    else if(event==='done') legacyDone=true;
    else if (event === 'result' || value.type === 'result' || value.message) result = validateReply(value.data ?? value);
    else if (event === 'error') throw new Error('에이전트 처리에 실패했어요.');
  }
  while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n'); let end; while ((end = buffer.indexOf('\n\n')) !== -1) { process(buffer.slice(0,end)); buffer = buffer.slice(end+2); } if (done) break; }
  if (buffer.trim()) process(buffer);
  if(!result&&legacyDone&&accumulated){const all=await registeredBills();const query=String((body as {message?:string}).message??'');const kind=/월세/.test(query)?'rent':/전기|한전/.test(query)?'electricity':undefined;const cards=all.filter(b=>!kind||b.kind===kind);result={message:accumulated,bill_cards:cards,mode:cards.some(b=>b.source==='sample')?'sample':'real',connection:/한전|전기/.test(query)};}
  if (!result) throw new Error('최종 카드 응답을 받지 못했어요.');
  return result;
}
