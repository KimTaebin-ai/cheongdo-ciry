import { describe, it, expect } from 'vitest';
import { dueDate, parseRent, reminderDates, safePaymentUrl, transferText } from './domain';
describe('financial date and data rules', () => {
  it('clamps recurring rent to the final day including leap years', () => { expect(dueDate('2026-02',31)).toBe('2026-02-28'); expect(dueDate('2028-02',31)).toBe('2028-02-29'); });
  it('converts KST 9am and never creates past reminders', () => { expect(reminderDates('2026-11-20',[3,1],9,new Date('2026-11-18T00:00:00Z'))).toEqual(['2026-11-19T00:00:00.000Z']); });
  it('preserves account leading zeros and parses a Korean amount', () => { expect(parseRent('월세 45만 원, 매달 8일, 예시은행 000-123-456789, 예금주 김예시')).toMatchObject({ amount_krw:450000,due_day:8,account_number:'000-123-456789',account_holder:'김예시' }); });
  it('does not silently accept an invalid due day', () => { expect(parseRent('매달 99일')).not.toHaveProperty('due_day'); });
  it('restricts payment URLs to exact official HTTPS hosts', () => { expect(safePaymentUrl('https://online.kepco.co.kr/')).toBeTruthy(); for(const s of ['javascript:alert(1)','https://online.kepco.co.kr.evil.com/','https://evil.com/','http://online.kepco.co.kr/','https://user@online.kepco.co.kr/']) expect(safePaymentUrl(s)).toBeNull(); });
  it('includes all required transfer fields without changing the account', () => { expect(transferText({amount_krw:450000,due_day:8,bank:'예시은행',account_number:'000-01',account_holder:'김예시',start_month:'2026-11'})).toContain('예시은행 000-01'); });
});
