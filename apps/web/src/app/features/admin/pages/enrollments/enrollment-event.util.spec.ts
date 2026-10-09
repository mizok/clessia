import { toEnrollmentEvent } from './enrollment-event.util';

describe('toEnrollmentEvent', () => {
  it('在學是新報名，日期看生效起日', () => {
    expect(
      toEnrollmentEvent({ status: 'active', effectiveFrom: '2026-08-01', effectiveTo: null }),
    ).toEqual({ kind: 'joined', date: '2026-08-01' });
  });

  it('退班的日期看退班日，不是當初報名的日子', () => {
    expect(
      toEnrollmentEvent({
        status: 'withdrawal',
        effectiveFrom: '2026-02-01',
        effectiveTo: '2026-08-14',
      }),
    ).toEqual({ kind: 'left', date: '2026-08-14' });
  });

  it('void（作廢）不是退班，日期同樣看 effectiveTo', () => {
    expect(
      toEnrollmentEvent({ status: 'void', effectiveFrom: '2026-02-01', effectiveTo: '2026-08-14' }),
    ).toEqual({ kind: 'voided', date: '2026-08-14' });
  });

  // 暫停不寫 effective_to，人還在班上 —— 它唯一的日期是 status_changed_at
  it('暫停是「暫停」，日期看 statusChangedAt', () => {
    expect(
      toEnrollmentEvent({
        status: 'suspended',
        effectiveFrom: '2026-02-01',
        effectiveTo: null,
        statusChangedAt: '2026-08-10',
      }),
    ).toEqual({ kind: 'paused', date: '2026-08-10' });
  });

  it('暫停但舊資料沒有 statusChangedAt 時退回生效起日', () => {
    expect(
      toEnrollmentEvent({ status: 'suspended', effectiveFrom: '2026-08-01', effectiveTo: null })
        .date,
    ).toBe('2026-08-01');
  });

  it('作廢缺 effectiveTo 時依序退回 statusChangedAt、生效起日', () => {
    expect(
      toEnrollmentEvent({
        status: 'void',
        effectiveFrom: '2026-02-01',
        effectiveTo: null,
        statusChangedAt: '2026-08-12',
      }).date,
    ).toBe('2026-08-12');
    expect(
      toEnrollmentEvent({ status: 'void', effectiveFrom: '2026-02-01', effectiveTo: null }).date,
    ).toBe('2026-02-01');
  });

  it('待繳費與在學都是新報名', () => {
    expect(
      toEnrollmentEvent({
        status: 'pending_payment',
        effectiveFrom: '2026-08-01',
        effectiveTo: null,
      }).kind,
    ).toBe('joined');
  });

  // 排定未來結束日的在學生還沒離開 —— 用 effectiveTo 判斷會把他們誤標成退班
  it('在學但排了結束日，仍然算新報名', () => {
    expect(
      toEnrollmentEvent({
        status: 'active',
        effectiveFrom: '2026-08-01',
        effectiveTo: '2026-12-31',
      }),
    ).toEqual({ kind: 'joined', date: '2026-08-01' });
  });

  it('退班但缺 effectiveTo 時退回生效起日，不會是 undefined', () => {
    expect(
      toEnrollmentEvent({ status: 'withdrawal', effectiveFrom: '2026-02-01', effectiveTo: null })
        .date,
    ).toBe('2026-02-01');
  });
});
