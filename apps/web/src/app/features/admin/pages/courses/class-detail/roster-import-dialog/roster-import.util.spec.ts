import { MAX_ROSTER_ROWS, matchSchoolNames, parseRosterSheet } from './roster-import.util';

const HEADER = [
  ['姓名', '就讀學校'],
  ['王小明', '台北市立文山國中'],
];

describe('parseRosterSheet', () => {
  it('跳過前兩列（標題 + 說明），照位置讀姓名與學校', () => {
    const result = parseRosterSheet([...HEADER, ['陳大同', '文山國中'], ['林小美', '景美國中']]);

    expect(result.error).toBeNull();
    expect(result.rows).toEqual([
      { index: 1, name: '陳大同', school: '文山國中', error: null },
      { index: 2, name: '林小美', school: '景美國中', error: null },
    ]);
  });

  it('忽略整列空白，但保留列號的連續性', () => {
    const result = parseRosterSheet([
      ...HEADER,
      ['陳大同', '文山國中'],
      ['', ''],
      ['林小美', '景美國中'],
    ]);

    expect(result.rows.map((row) => row.name)).toEqual(['陳大同', '林小美']);
    expect(result.rows.map((row) => row.index)).toEqual([1, 2]);
  });

  it('缺姓名或缺學校的列標成錯誤，不是整份拒絕', () => {
    const result = parseRosterSheet([...HEADER, ['陳大同', ''], ['', '景美國中']]);

    expect(result.error).toBeNull();
    expect(result.rows[0].error).toBe('缺少就讀學校');
    expect(result.rows[1].error).toBe('缺少姓名');
  });

  it('數字型儲存格轉成字串，不會變成 [object Object]', () => {
    const result = parseRosterSheet([...HEADER, [12345, '文山國中']]);

    expect(result.rows[0].name).toBe('12345');
  });

  it('前後空白去掉 —— Excel 複製貼上很容易帶進來', () => {
    const result = parseRosterSheet([...HEADER, ['  陳大同 ', ' 文山國中']]);

    expect(result.rows[0]).toMatchObject({ name: '陳大同', school: '文山國中' });
  });

  // batchCreate 上限 50。切塊送出會造成「一半進系統一半沒有」，所以在解析階段就擋。
  it(`超過 ${MAX_ROSTER_ROWS} 列直接擋掉整份`, () => {
    const many = Array.from({ length: MAX_ROSTER_ROWS + 1 }, (_, i) => [`學生${i}`, '文山國中']);

    const result = parseRosterSheet([...HEADER, ...many]);

    expect(result.rows).toEqual([]);
    expect(result.error).toContain(String(MAX_ROSTER_ROWS));
  });

  it('只有標題沒有資料時回空清單而不是爆掉', () => {
    expect(parseRosterSheet(HEADER).rows).toEqual([]);
    expect(parseRosterSheet([]).rows).toEqual([]);
  });
});

describe('matchSchoolNames', () => {
  const schools = [
    { id: 's1', name: '台北市立文山國中', shortName: '文山' },
    { id: 's2', name: '新北市立景美國中', shortName: null },
    { id: 's3', name: '台北市立木柵國中', shortName: null },
  ];

  it('完全相符直接解析', () => {
    const [match] = matchSchoolNames(['台北市立文山國中'], schools);

    expect(match.resolvedId).toBe('s1');
    expect(match.candidates).toHaveLength(1);
  });

  // 這是整個匯入功能能不能用的關鍵：名單上寫的是簡稱，系統裡存的是全名
  it('名單寫簡稱時仍然對得到全名', () => {
    const [match] = matchSchoolNames(['文山國中'], schools);

    expect(match.resolvedId).toBe('s1');
  });

  it('對得上 short_name', () => {
    const [match] = matchSchoolNames(['文山'], schools);

    expect(match.resolvedId).toBe('s1');
  });

  it('大小寫不影響比對', () => {
    const [match] = matchSchoolNames(
      ['taipei'],
      [{ id: 's9', name: 'Taipei American', shortName: null }],
    );

    expect(match.resolvedId).toBe('s9');
  });

  it('對到多間時不自動選，交給人挑', () => {
    const [match] = matchSchoolNames(['國中'], schools);

    expect(match.resolvedId).toBeNull();
    expect(match.candidates.length).toBeGreaterThan(1);
  });

  it('對不到任何學校時 candidates 是空的', () => {
    const [match] = matchSchoolNames(['不存在高中'], schools);

    expect(match.resolvedId).toBeNull();
    expect(match.candidates).toEqual([]);
  });

  it('重複的學校名只回傳一組對照', () => {
    const matches = matchSchoolNames(['文山國中', '文山國中', '景美國中'], schools);

    expect(matches.map((m) => m.input)).toEqual(['文山國中', '景美國中']);
  });
});
