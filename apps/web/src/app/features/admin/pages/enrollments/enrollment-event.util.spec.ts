import { leftNote, statusLabel, toEnrollmentEvent } from './enrollment-event.util';

// 日期是傳進去的，不讀時鐘 —— 寫死不會過期（test:timetravel）
const TODAY = '2026-10-10';
const ev = (enrollment: Parameters<typeof toEnrollmentEvent>[0]) =>
  toEnrollmentEvent(enrollment, TODAY);

describe('toEnrollmentEvent', () => {
  it('在學是新報名，日期看生效起日', () => {
    expect(ev({ status: 'active', effectiveFrom: '2026-08-01', effectiveTo: null })).toEqual({
      kind: 'joined',
      date: '2026-08-01',
    });
  });

  it('退班的日期看退班日，不是當初報名的日子', () => {
    expect(
      ev({
        status: 'withdrawal',
        effectiveFrom: '2026-02-01',
        effectiveTo: '2026-08-14',
      }),
    ).toEqual({ kind: 'left', date: '2026-08-14' });
  });

  it('void（作廢）不是退班，日期同樣看 effectiveTo', () => {
    expect(ev({ status: 'void', effectiveFrom: '2026-02-01', effectiveTo: '2026-08-14' })).toEqual({
      kind: 'voided',
      date: '2026-08-14',
    });
  });

  // 暫停不寫 effective_to，人還在班上 —— 它唯一的日期是 status_changed_at
  it('暫停是「暫停」，日期看 statusChangedAt', () => {
    expect(
      ev({
        status: 'suspended',
        effectiveFrom: '2026-02-01',
        effectiveTo: null,
        statusChangedAt: '2026-08-10',
      }),
    ).toEqual({ kind: 'paused', date: '2026-08-10' });
  });

  it('暫停但舊資料沒有 statusChangedAt 時退回生效起日', () => {
    expect(ev({ status: 'suspended', effectiveFrom: '2026-08-01', effectiveTo: null }).date).toBe(
      '2026-08-01',
    );
  });

  it('作廢缺 effectiveTo 時依序退回 statusChangedAt、生效起日', () => {
    expect(
      ev({
        status: 'void',
        effectiveFrom: '2026-02-01',
        effectiveTo: null,
        statusChangedAt: '2026-08-12',
      }).date,
    ).toBe('2026-08-12');
    expect(ev({ status: 'void', effectiveFrom: '2026-02-01', effectiveTo: null }).date).toBe(
      '2026-02-01',
    );
  });

  it('待繳費與在學都是新報名', () => {
    expect(
      ev({
        status: 'pending_payment',
        effectiveFrom: '2026-08-01',
        effectiveTo: null,
      }).kind,
    ).toBe('joined');
  });

  // 排定未來結束日的在學生還沒離開 —— 用 effectiveTo 判斷會把他們誤標成退班
  it('在學但排了結束日，仍然算新報名', () => {
    expect(
      ev({
        status: 'active',
        effectiveFrom: '2026-08-01',
        effectiveTo: '2026-12-31',
      }),
    ).toEqual({ kind: 'joined', date: '2026-08-01' });
  });

  it('退班但缺 effectiveTo 時退回生效起日，不會是 undefined', () => {
    expect(ev({ status: 'withdrawal', effectiveFrom: '2026-02-01', effectiveTo: null }).date).toBe(
      '2026-02-01',
    );
  });

  // #1507 計畫席裁：active 的 effective_to 過了就離開名冊 —— 到期結束也是退班，跟 API 計數同判準
  it('在學但結束日已到（含今天），算退班，日期看結束日', () => {
    expect(
      ev({ status: 'active', effectiveFrom: '2026-08-01', effectiveTo: '2026-10-03' }),
    ).toEqual({ kind: 'left', date: '2026-10-03' });
    expect(ev({ status: 'active', effectiveFrom: '2026-08-01', effectiveTo: TODAY }).kind).toBe(
      'left',
    );
  });

  it('有指定事件篩選時顯示那件事：報了又退的人在「新報名」篩選下寫新報名、日期看起日', () => {
    const churned = {
      status: 'withdrawal' as const,
      effectiveFrom: '2026-10-02',
      effectiveTo: '2026-10-08',
    };
    expect(ev(churned).kind).toBe('left');
    expect(toEnrollmentEvent(churned, TODAY, 'joined')).toEqual({
      kind: 'joined',
      date: '2026-10-02',
    });
  });
});

describe('statusLabel', () => {
  it('到期結束（active、結束日已過）寫「已結束」，不寫在學', () => {
    expect(
      statusLabel(
        { status: 'active', effectiveFrom: '2026-08-01', effectiveTo: '2026-10-09' },
        TODAY,
      ),
    ).toBe('已結束');
  });

  // effective_to 當天還在籍
  it('結束日是今天或還沒到，照 enum 寫', () => {
    expect(
      statusLabel({ status: 'active', effectiveFrom: '2026-08-01', effectiveTo: TODAY }, TODAY),
    ).toBe('在學');
    expect(
      statusLabel(
        { status: 'withdrawal', effectiveFrom: '2026-08-01', effectiveTo: '2026-09-01' },
        TODAY,
      ),
    ).toBe('退班');
  });
});

describe('leftNote', () => {
  it('辦理退班與到期結束分開寫', () => {
    expect(
      leftNote({ status: 'withdrawal', effectiveFrom: '2026-08-01', effectiveTo: '2026-09-01' }),
    ).toBe('辦理退班');
    expect(
      leftNote({ status: 'active', effectiveFrom: '2026-08-01', effectiveTo: '2026-09-01' }),
    ).toBe('到期結束');
  });
});
