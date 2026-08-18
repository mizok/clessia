import { toEnrollmentEvent } from './enrollment-event.util';

describe('toEnrollmentEvent', () => {
  it('在籍是新報名，日期看生效起日', () => {
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

  it('失效也算退出', () => {
    expect(
      toEnrollmentEvent({ status: 'void', effectiveFrom: '2026-02-01', effectiveTo: '2026-08-14' })
        .kind,
    ).toBe('left');
  });

  // 停權不寫 effective_to，人還在班上
  it('停權不算退出', () => {
    expect(
      toEnrollmentEvent({ status: 'suspended', effectiveFrom: '2026-08-01', effectiveTo: null })
        .kind,
    ).toBe('joined');
  });

  // 排定未來結束日的在籍生還沒離開 —— 用 effectiveTo 判斷會把他們誤標成退班
  it('在籍但排了結束日，仍然算新報名', () => {
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
