import { describe, it, expect } from 'vitest';
import { DemoSession } from './demo';
describe('frontend simulator state safety', () => {
  it('asks for missing fields and saves only after confirmation', () => { const d=new DemoSession(); expect(d.send('월세 45만 원, 매달 8일로 등록해줘').pending_action).toBeUndefined(); const r=d.send('예시은행 000-123-456789 예금주 김예시'); expect(r.pending_action?.kind).toBe('rent'); expect(d.rent).toBeUndefined(); d.confirm(r.pending_action!.id); expect(d.rent?.account_number).toBe('000-123-456789'); });
  it('rejects reused confirmations and replaces stale proposals', () => { const d=new DemoSession(); const a=d.send('월세 45만 원 매달 8일 예시은행 000-123-456789 예금주 김예시 등록'); const b=d.send('월세 50만 원으로 수정'); expect(d.confirm(a.pending_action!.id).message).toContain('만료'); d.confirm(b.pending_action!.id); expect(d.rent?.amount_krw).toBe(500000); expect(d.confirm(b.pending_action!.id).message).toContain('만료'); });
  it('does not duplicate a bill or mark a lookup as paid', () => { const d=new DemoSession(); d.send('한전 샘플'); d.send('전기요금 조회'); expect(d.bills).toHaveLength(1); expect(d.bills[0].status).toBe('pending'); const a=d.send('전기요금 납부했어'); expect(d.bills[0].status).toBe('pending'); d.confirm(a.pending_action!.id); expect(d.bills[0].status).toBe('user_confirmed'); d.send('전기요금 조회'); expect(d.bills[0].status).toBe('user_confirmed'); });
  it('does not deliver notifications without consent', () => { const d=new DemoSession(); d.send('한전 샘플'); expect(d.dueNotifications()).toEqual([]); });
});
