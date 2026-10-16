import {
  classGroups,
  courseGroups,
  emptyValues,
  missingSummary,
  retryMinutes,
  toPayload,
  validate,
  type FormValues,
  type PublicCatalogClass,
} from './application-form.model';

const TODAY = '2026-10-16';

const filled = (extra: Partial<FormValues> = {}): FormValues => ({
  ...emptyValues(),
  parentName: '王小明',
  phone: '0912-345-678',
  relation: 'father',
  studentName: '王柏翰',
  grade: 'P5',
  school: '興隆國小',
  targets: ['x'],
  consent: true,
  ...extra,
});

const cls = (extra: Partial<PublicCatalogClass> = {}): PublicCatalogClass => ({
  classId: 'c1',
  className: '國小數學 A 班',
  gradeLevels: ['P5'],
  courseId: 'co1',
  courseName: '國小數學',
  subject: '數學',
  campusName: '信義校',
  slots: [{ weekday: 3, startTime: '18:30', endTime: '20:00' }],
  remainingSeats: 2,
  fee: { amount: 4800, billingMode: 'monthly' },
  teacherNicknames: [],
  ...extra,
});

describe('validate（照 A6 check()，跟 API 同一套規則）', () => {
  it('全部填好：沒有錯', () => {
    expect(validate('trial', filled(), TODAY)).toEqual({});
  });

  it('空表單：每個必填都有 A6 原文，順序就是「還沒填好」的順序', () => {
    const e = validate('enrollment', emptyValues(), TODAY);
    expect(e).toEqual({
      parentName: '還沒填家長姓名',
      email: 'Email 和手機至少填一個',
      phone: 'Email 和手機至少填一個',
      relation: '還沒選與學生的關係',
      studentName: '還沒填學生姓名',
      grade: '還沒選年級',
      school: '還沒填就讀學校',
      targets: '至少選一個開課班',
      consent: '要先同意個資使用聲明，補習班才能聯絡你',
    });
    expect(missingSummary('enrollment', e)).toBe(
      '還沒填好：家長姓名、Email 或手機、與學生的關係、學生姓名、年級、就讀學校、開課班、同意聲明',
    );
  });

  it('試聽也要「與學生的關係」（Q1）；課程的錯誤文案與摘要用「課程」', () => {
    const e = validate('trial', filled({ relation: '', targets: [] }), TODAY);
    expect(e.relation).toBe('還沒選與學生的關係');
    expect(e.targets).toBe('至少選一個想試聽的課程');
    expect(missingSummary('trial', e)).toBe('還沒填好：與學生的關係、課程');
  });

  it('手機去掉 - 與空白後要是 09 開頭 10 碼；Email 格式', () => {
    expect(validate('trial', filled({ phone: '0912 345 678' }), TODAY)).toEqual({});
    expect(validate('trial', filled({ phone: '0212345678' }), TODAY).phone).toBe(
      '手機要是 09 開頭的 10 碼數字',
    );
    expect(validate('trial', filled({ email: 'a@b' }), TODAY).email).toBe(
      'Email 格式不對，例：name@example.com',
    );
  });

  it('報名的期望開始日期不能早於今天；今天可以；試聽沒有這一欄', () => {
    expect(validate('enrollment', filled({ startDate: '2026-10-15' }), TODAY).startDate).toBe(
      '開始日期不能早於今天',
    );
    expect(validate('enrollment', filled({ startDate: TODAY }), TODAY)).toEqual({});
    expect(validate('trial', filled({ startDate: '2026-10-15' }), TODAY)).toEqual({});
  });
});

describe('toPayload', () => {
  it('試聽：courseIds＋preferredTimes；手機去掉分隔；空的選填不帶', () => {
    expect(
      toPayload('trial', filled({ targets: ['co1'], preferredTimes: ' 週三晚上 ' }), 'tok'),
    ).toEqual({
      parent: { name: '王小明', email: undefined, phone: '0912345678', relation: 'father' },
      student: { name: '王柏翰', grade: 'P5', school: '興隆國小' },
      note: undefined,
      consent: true,
      website: undefined,
      captchaToken: 'tok',
      courseIds: ['co1'],
      preferredTimes: '週三晚上',
    });
  });

  it('報名：classIds＋preferredStartDate；honeypot 有值就照送（API 回假成功）', () => {
    const body = toPayload(
      'enrollment',
      filled({ targets: ['c1'], startDate: '2026-11-01', website: 'http://spam' }),
      'tok',
    );
    expect(body).toMatchObject({
      classIds: ['c1'],
      preferredStartDate: '2026-11-01',
      website: 'http://spam',
    });
    expect(body).not.toHaveProperty('courseIds');
  });
});

describe('retryMinutes（429 的 Retry-After 換成分鐘）', () => {
  it('無條件進位；讀不到或不是正數回 null', () => {
    expect(retryMinutes('3600')).toBe(60);
    expect(retryMinutes('61')).toBe(2);
    expect(retryMinutes(null)).toBeNull();
    expect(retryMinutes('abc')).toBeNull();
    expect(retryMinutes('0')).toBeNull();
  });
});

describe('courseGroups（試聽：依 courseId 合併成課程、依科目分組）', () => {
  it('同一門課的兩個班合成一列，寫年級、時段、幾個班；單一分校不寫分校', () => {
    const groups = courseGroups([
      cls(),
      cls({
        classId: 'c2',
        gradeLevels: ['P6'],
        slots: [{ weekday: 6, startTime: '09:00', endTime: '11:00' }],
      }),
      cls({
        classId: 'c3',
        courseId: 'co2',
        courseName: '國中英文',
        subject: '英文',
        gradeLevels: ['J1'],
      }),
    ]);
    expect(groups.map((g) => g.subject)).toEqual(['數學', '英文']);
    expect(groups[0]!.options).toEqual([
      {
        id: 'co1',
        name: '國小數學',
        gradeLevels: ['P5', 'P6'],
        detail: '小五、小六 · 週三 18:30、週六 09:00 · 2 個班可選',
      },
    ]);
  });

  it('多分校時列出有開這門課的分校', () => {
    const [group] = courseGroups([cls(), cls({ classId: 'c2', campusName: '文山校' })]);
    expect(group!.options[0]!.detail).toContain('信義校、文山校');
  });
});

describe('classGroups（報名：每班一列）', () => {
  it('時段、老師暱稱（有才寫）、學費、名額；額滿標 full', () => {
    const [group] = classGroups([
      cls({ teacherNicknames: ['大文老師'] }),
      cls({ classId: 'c2', remainingSeats: 0, fee: null, teacherNicknames: [] }),
    ]);
    expect(group!.options[0]).toMatchObject({
      detail: '週三 18:30–20:00 · 大文老師',
      fee: '4,800 元／月',
      full: false,
      seats: 2,
      start: '週三 18:30',
    });
    expect(group!.options[1]).toMatchObject({ detail: '週三 18:30–20:00', fee: null, full: true });
  });

  it('多分校時時段後面加分校名；堂數包、期繳的單位', () => {
    const [group] = classGroups([
      cls({ fee: { amount: 12000, billingMode: 'session_pack' } }),
      cls({ classId: 'c2', campusName: '文山校', fee: { amount: 9000, billingMode: 'period' } }),
    ]);
    expect(group!.options[0]!.detail).toBe('週三 18:30–20:00 · 信義校');
    expect(group!.options.map((o) => o.fee)).toEqual(['12,000 元／堂數包', '9,000 元／期']);
  });
});
