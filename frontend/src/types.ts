export type Rent = { amount_krw: number; due_day: number; bank: string; account_number: string; account_holder: string; start_month: string };
/** 공통 계약(TRD 3절 + C backend/app/models.py). 금액·날짜가 없으면 null이며 화면에서 만들어내지 않는다. */
export type Bill = { id: string; kind: 'electricity' | 'rent'; period: string; amount_krw: number | null; due_date: string | null; autopay: boolean | null; status: 'pending' | 'user_confirmed'; source: 'real' | 'sample' | 'manual'; checked_at: string | null; payment_url?: string | null; reminder_enabled?: boolean; due_date_adjusted?: boolean };
export type Action = { id: string; kind: 'rent' | 'electricity' | 'paid' | 'reminder' | 'proposal'; rent?: Rent; bill?: Bill; bill_id?: string; hour?: number; days?: number[]; missing?: string[] };
/** via: agent=백엔드 AI 에이전트 응답, app=앱 API 직접 처리, demo=프런트 규칙 기반 데모 */
export type Reply = { message: string; bill_cards?: Bill[]; rent_transfer_text?: string | null; pending_action?: Action | null; mode: 'real' | 'sample'; rent?: Rent; connection?: boolean; reminders?: string[]; notice?: string | null; consent_prompt?: boolean; via?: 'agent' | 'app' | 'demo'; tools?: string[] };
export type Message = { id: string; role: 'user' | 'assistant'; text: string; reply?: Reply; resolved?: boolean };
export type Notice = { id: string; bill_id: string; message: string; scheduled_at_utc: string; delivered_at?: string | null; source: Bill['source']; demo_time_shift?: boolean };
