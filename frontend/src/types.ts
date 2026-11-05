export type Rent = { amount_krw: number; due_day: number; bank: string; account_number: string; account_holder: string; start_month: string };
export type Bill = { id: string; kind: 'electricity' | 'rent'; period: string; amount_krw: number; due_date: string; autopay: boolean | null; status: 'pending' | 'user_confirmed'; source: 'real' | 'sample' | 'manual'; checked_at: string; payment_url?: string | null };
export type Action = { id: string; kind: 'rent' | 'electricity' | 'paid' | 'reminder'; rent?: Rent; bill?: Bill; bill_id?: string; hour?: number; days?: number[] };
export type Reply = { message: string; bill_cards?: Bill[]; rent_transfer_text?: string | null; pending_action?: Action | null; mode: 'real' | 'sample'; rent?: Rent; connection?: boolean; reminders?: string[] };
export type Message = { id: string; role: 'user' | 'assistant'; text: string; reply?: Reply; resolved?: boolean };
