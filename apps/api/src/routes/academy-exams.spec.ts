import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import academyExamsApp, { buildAcademyScoreRows, isPassScoreValid } from './academy-exams';

describe('isPassScoreValid', () => {
  it('null / undefined 一律合法（未設，不是設成 0）', () => {
    expect(isPassScoreValid(null, 100)).toBe(true);
    expect(isPassScoreValid(undefined, 100)).toBe(true);
  });

  it('0 是有效值（這場不當人）', () => {
    expect(isPassScoreValid(0, 100)).toBe(true);
  });

  it('等於總分合法，超過總分不合法', () => {
    expect(isPassScoreValid(100, 100)).toBe(true);
    expect(isPassScoreValid(101, 100)).toBe(false);
  });

  it('負數不合法', () => {
    expect(isPassScoreValid(-1, 100)).toBe(false);
  });
});

const student = (name: string, grade = 'J2') => ({ name, grade });

describe('buildAcademyScoreRows', () => {
  it('把在籍但尚未登錄成績的學生也列出來', () => {
    const rows = buildAcademyScoreRows(
      [{ student_id: 's1', class_id: 'c1', students: student('王小明') }],
      [],
    );

    expect(rows).toEqual([
      {
        studentId: 's1',
        studentName: '王小明',
        studentGrade: 'J2',
        score: null,
        status: 'scored',
        notes: null,
        updatedAt: null,
        classIds: ['c1'],
      },
    ]);
  });

  it('跨班學生的 classIds 要累積，不能只留最後一個班', () => {
    // 同一個學生報了這場考試的兩個班（例如數學 A 班 + 數學進階班），
    // enrollments 會回兩筆。只保留一個的話，按另一班篩選時這個學生就消失了。
    const rows = buildAcademyScoreRows(
      [
        { student_id: 's1', class_id: 'c1', students: student('王小明') },
        { student_id: 's1', class_id: 'c2', students: student('王小明') },
      ],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].classIds).toEqual(['c1', 'c2']);
  });

  it('重複的 class_id 不會重複累積', () => {
    const rows = buildAcademyScoreRows(
      [
        { student_id: 's1', class_id: 'c1', students: student('王小明') },
        { student_id: 's1', class_id: 'c1', students: student('王小明') },
      ],
      [],
    );

    expect(rows[0].classIds).toEqual(['c1']);
  });

  it('已登錄的成績會覆蓋分數欄位，但不能洗掉 classIds', () => {
    const rows = buildAcademyScoreRows(
      [
        { student_id: 's1', class_id: 'c1', students: student('王小明') },
        { student_id: 's1', class_id: 'c2', students: student('王小明') },
      ],
      [
        {
          student_id: 's1',
          score: 88,
          status: 'scored',
          notes: '進步很多',
          updated_at: '2026-04-02T00:00:00Z',
          students: student('王小明'),
        },
      ],
    );

    expect(rows[0].score).toBe(88);
    expect(rows[0].notes).toBe('進步很多');
    expect(rows[0].classIds).toEqual(['c1', 'c2']);
  });

  it('有成績的學生排在沒成績的前面，同組內依更新時間新到舊', () => {
    const rows = buildAcademyScoreRows(
      [
        { student_id: 's1', class_id: 'c1', students: student('甲') },
        { student_id: 's2', class_id: 'c1', students: student('乙') },
        { student_id: 's3', class_id: 'c1', students: student('丙') },
      ],
      [
        {
          student_id: 's3',
          score: 70,
          status: 'scored',
          notes: null,
          updated_at: '2026-04-01T00:00:00Z',
          students: student('丙'),
        },
        {
          student_id: 's2',
          score: 90,
          status: 'scored',
          notes: null,
          updated_at: '2026-04-03T00:00:00Z',
          students: student('乙'),
        },
      ],
    );

    expect(rows.map((r) => r.studentId)).toEqual(['s2', 's3', 's1']);
  });

  it('沒有 class_id 的 enrollment 不會塞 null 進 classIds', () => {
    const rows = buildAcademyScoreRows(
      [{ student_id: 's1', class_id: null, students: student('王小明') }],
      [],
    );

    expect(rows[0].classIds).toEqual([]);
  });
});

/**
 * **待登錄的判定活在路由裡，純函式測試看不到它。**
 *
 * `buildAcademyExamExpectedCounts` 只知道「餵進來的資料算出幾個人」；
 * 「哪些考試是候選」「`exam_date` 有沒有被撈回來」「`todoLevel` 有沒有被接住」
 * 全都在這一層 —— 而少撈 `exam_date` 的後果是**每一場的分母都變成 0，於是告警
 * 靜靜地永遠是空的**（charter：驗證要打到出錯的那一層）。
 */
describe('GET /api/academy-exams —— 待登錄的判定（N < M，分兩級）', () => {
  interface Fixture {
    activeExams: Array<{ id: string; exam_date: string }>;
    examClasses: Array<{ exam_id: string; class_id: string }>;
    enrollments: Array<{
      class_id: string;
      student_id: string;
      effective_from: string;
      effective_to: string | null;
    }>;
    scores: Array<{ exam_id: string; student_id: string }>;
    /** 設了就讓 `academy_scores` 查詢失敗 */
    scoresError?: string;
  }

  /**
   * **替身要照路由實際 select 的欄位投影。** 不投影的話，路由少撈一個欄位
   * （例如 `exam_date`）替身照樣回全欄位，於是「對的實作」與「錯的實作」
   * 在這個測試上產生一樣的觀察值 —— 那個測試就沒有在測那件事。
   * （這一段是先寫完測試、拿「拿掉 `exam_date`」當陷阱去撞，發現撞不紅才補的。）
   */
  function project<T extends Record<string, unknown>>(rows: T[], columns: string): T[] {
    const wanted = columns
      .split(',')
      .map((col) => col.trim())
      .filter(Boolean);
    if (wanted.length === 0) return rows;
    return rows.map(
      (row) => Object.fromEntries(Object.entries(row).filter(([key]) => wanted.includes(key))) as T,
    );
  }

  function createListApp(fixture: Fixture, campusScope: readonly string[] | null = null) {
    // 主查詢最後下的 `.in('id', ...)` 就是「哪幾場被判成待登錄」——
    // 直接釘住它，比斷言回傳筆數有鑑別力（筆數在對錯兩種實作下可以一樣）
    let todoIdFilter: string[] | null = null;
    // 分校範圍靠 `.in('campus_id', …)` 下到查詢上，而這個替身回的是固定 fixture ——
    // 「有下」與「沒下」在回傳值上完全一樣，所以記下送出去的查詢長什麼樣
    const inCalls: Array<{ table: string; column: string; values: string[] }> = [];

    const supabase = {
      from(table: string) {
        let columns = '';
        const query: Record<string, unknown> = {
          select: (cols?: string) => {
            columns = cols ?? '';
            return query;
          },
          eq: () => query,
          neq: () => query,
          ilike: () => query,
          gte: () => query,
          lte: () => query,
          order: () => query,
          range: () => query,
          in: (column: string, values: string[]) => {
            inCalls.push({ table, column, values: [...values] });
            if (table === 'academy_exams' && column === 'id') todoIdFilter = values;
            return query;
          },
          then: (onfulfilled?: ((value: unknown) => unknown) | null) => {
            let result: unknown = { data: [], error: null, count: 0 };

            if (table === 'academy_exams' && columns.includes('academy_scores(count)')) {
              const visible = fixture.activeExams.filter(
                (exam) => !todoIdFilter || todoIdFilter.includes(exam.id),
              );
              result = {
                data: visible.map((exam) => ({
                  id: exam.id,
                  name: exam.id,
                  exam_type: 'quiz',
                  status: 'active',
                  exam_date: exam.exam_date,
                  total_score: 100,
                  pass_score: null,
                  scope_note: null,
                  campus_id: null,
                  subject_id: null,
                  created_at: '2026-04-01T00:00:00Z',
                  updated_at: '2026-04-01T00:00:00Z',
                  subjects: null,
                  academy_exam_classes: fixture.examClasses
                    .filter((row) => row.exam_id === exam.id)
                    .map((row) => ({
                      class_id: row.class_id,
                      classes: { name: `班-${row.class_id}` },
                    })),
                  academy_scores: [
                    { count: fixture.scores.filter((row) => row.exam_id === exam.id).length },
                  ],
                })),
                error: null,
                count: visible.length,
              };
            } else if (table === 'academy_exams') {
              result = { data: project(fixture.activeExams, columns), error: null };
            } else if (table === 'academy_exam_classes') {
              result = { data: project(fixture.examClasses, columns), error: null };
            } else if (table === 'enrollments') {
              result = { data: project(fixture.enrollments, columns), error: null };
            } else if (table === 'academy_scores') {
              result = fixture.scoresError
                ? { data: null, error: { message: fixture.scoresError } }
                : { data: project(fixture.scores, columns), error: null };
            }

            return Promise.resolve(result).then(onfulfilled ?? undefined);
          },
        };
        return query;
      },
    };

    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', 'user-1');
      context.set('roles', ['admin']);
      context.set('campusScope', campusScope);
      await next();
    });
    app.route('/api/academy-exams', academyExamsApp);

    async function list(queryString: string) {
      const response = await app.request(`/api/academy-exams?${queryString}`, {}, undefined, {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
      } as never);
      return {
        response,
        body: (await response.json()) as { data: Array<Record<string, unknown>> },
      };
    }

    async function todoCount() {
      const response = await app.request('/api/academy-exams/todo-count', {}, undefined, {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
      } as never);
      return { response, body: (await response.json()) as Record<string, unknown> };
    }

    return { list, todoCount, todoIds: () => todoIdFilter, inCalls };
  }

  // 三場都在 4/10：登完的、登到一半的、一筆都沒有的
  const BASE: Fixture = {
    activeExams: [
      { id: 'exam-done', exam_date: '2026-04-10' },
      { id: 'exam-partial', exam_date: '2026-04-10' },
      { id: 'exam-empty', exam_date: '2026-04-10' },
    ],
    examClasses: [
      { exam_id: 'exam-done', class_id: 'c-done' },
      { exam_id: 'exam-partial', class_id: 'c-partial' },
      { exam_id: 'exam-empty', class_id: 'c-empty' },
    ],
    enrollments: [
      ...['s1', 's2'].map((student_id) => ({
        class_id: 'c-done',
        student_id,
        effective_from: '2026-01-01',
        effective_to: null,
      })),
      ...['s3', 's4'].map((student_id) => ({
        class_id: 'c-partial',
        student_id,
        effective_from: '2026-01-01',
        effective_to: null,
      })),
      ...['s5', 's6'].map((student_id) => ({
        class_id: 'c-empty',
        student_id,
        effective_from: '2026-01-01',
        effective_to: null,
      })),
    ],
    scores: [
      { exam_id: 'exam-done', student_id: 's1' },
      { exam_id: 'exam-done', student_id: 's2' },
      { exam_id: 'exam-partial', student_id: 's3' },
    ],
  };

  /**
   * #949：已登錄數 N 改由 loader 那支成績查詢一起算（原本兩支路由各自再查一次）。
   * loader 對分母那兩支查詢的錯誤是吞掉的 —— **成績那支不能照吞**：N 變 0 的話每場都被判成
   * 「一筆都沒登」，待辦數灌水，而畫面看起來完全正常。
   */
  it('成績查詢失敗 → todo 列表與 todo-count 都回 400，不是把每場判成待辦', async () => {
    const { list, todoCount } = createListApp({ ...BASE, scoresError: 'boom' });

    expect((await list('todo=true')).response.status).toBe(400);
    expect((await todoCount()).response.status).toBe(400);
  });

  it('todo-count 的數字跟 todo 列表同一套判定（一場一半、一場全空）', async () => {
    const { todoCount } = createListApp(BASE);

    expect((await todoCount()).body).toEqual({ count: 2, none: 1, partial: 1 });
  });

  it('`todo=true` → 登完的不算待登錄，登到一半的算', async () => {
    // 舊定義是「一筆都沒有」，於是 `exam-partial`（2 個人只登了 1 個）完全看不到
    const { list, todoIds } = createListApp(BASE);
    await list('todo=true');

    expect(todoIds()?.sort()).toEqual(['exam-empty', 'exam-partial']);
  });

  it('`todoLevel=none` → 只有一筆都沒有的那些（高）', async () => {
    const { list, todoIds } = createListApp(BASE);
    await list('todo=true&todoLevel=none');

    expect(todoIds()).toEqual(['exam-empty']);
  });

  it('`todoLevel=partial` → 只有登到一半的那些（低）', async () => {
    // 不合併成一級：告警量會上升，一級化會讓最急的那類被稀釋進去
    const { list, todoIds } = createListApp(BASE);
    await list('todo=true&todoLevel=partial');

    expect(todoIds()).toEqual(['exam-partial']);
  });

  it('⚠️ 考完才轉入的學生不進分母 —— 否則那場永遠差一筆、補不了', async () => {
    // 舊實作用「現在 status=active」，六月插班的學生會掛在四月那場的分母上，
    // 於是 N/M 永遠到不了滿。補不滿的警示數字會被學會忽略。
    const { list, todoIds } = createListApp({
      activeExams: [{ id: 'exam-apr', exam_date: '2026-04-10' }],
      examClasses: [{ exam_id: 'exam-apr', class_id: 'c1' }],
      enrollments: [
        {
          class_id: 'c1',
          student_id: 'joined-later',
          effective_from: '2026-06-01',
          effective_to: null,
        },
      ],
      scores: [],
    });
    await list('todo=true');

    // 分母 0 → 沒有人要考 → 不是待登錄
    expect(todoIds()).toBeNull();
  });

  it('分母 0（綁了班但沒有在籍學生）→ 不算待登錄，那是清不掉的告警', async () => {
    const { list, todoIds } = createListApp({
      activeExams: [{ id: 'exam-x', exam_date: '2026-04-10' }],
      examClasses: [{ exam_id: 'exam-x', class_id: 'c1' }],
      enrollments: [],
      scores: [],
    });
    await list('todo=true&todoLevel=none');

    expect(todoIds()).toBeNull();
  });

  it('列表每一筆都帶 `expectedCount` —— 分母跟分子回在同一筆上', async () => {
    const { list } = createListApp(BASE);
    const { body } = await list('');

    const byId = new Map(body.data.map((row) => [row['id'], row]));
    expect(byId.get('exam-done')).toMatchObject({ scoreCount: 2, expectedCount: 2 });
    expect(byId.get('exam-partial')).toMatchObject({ scoreCount: 1, expectedCount: 2 });
    expect(byId.get('exam-empty')).toMatchObject({ scoreCount: 0, expectedCount: 2 });
  });

  it('列表每一筆帶參加班級 `classes[{id,name}]`（班名排序），`classCount` 是它的長度（#1314 G1）', async () => {
    const { list } = createListApp({
      ...BASE,
      activeExams: [...BASE.activeExams, { id: 'exam-none', exam_date: '2026-04-10' }],
      examClasses: [...BASE.examClasses, { exam_id: 'exam-done', class_id: 'c-a-extra' }],
    });
    const { body } = await list('');

    const byId = new Map(body.data.map((row) => [row['id'], row]));
    expect(byId.get('exam-done')).toMatchObject({
      classCount: 2,
      classes: [
        { id: 'c-a-extra', name: '班-c-a-extra' },
        { id: 'c-done', name: '班-c-done' },
      ],
    });
    expect(byId.get('exam-none')).toMatchObject({ classCount: 0, classes: [] });
    expect(byId.get('exam-empty')).toMatchObject({
      classCount: 1,
      classes: [{ id: 'c-empty', name: '班-c-empty' }],
    });
  });

  /**
   * 分校範圍有沒有下到查詢上（#515 下半，第三批）。
   *
   * `academy-exams.ts:581` 用 `applyCampusFilter(query, 'campus_id', …)`。
   * **只能斷言查詢形狀**：這個替身回的是固定 fixture，條件下對下錯回一樣的東西。
   *
   * 它原本就記錄 `.in()`，但**只對 `academy_exams.id`**（那是「哪幾場待登錄」的
   * 判定，見 `createListApp` 檔頭）—— `campus_id` 完全沒被看過。
   */
  describe('分校範圍要下到查詢上', () => {
    it('受限管理員的考試列表帶著他的分校清單', async () => {
      const app = createListApp(BASE, ['campus-1']);

      await app.list('todo=true');

      const campusFilters = app.inCalls.filter((call) => call.column === 'campus_id');
      expect(campusFilters.length).toBeGreaterThan(0);
      for (const call of campusFilters) {
        expect(call.values).toEqual(['campus-1']);
      }
    });

    it('不受分校限制時不下這個條件（確認上一條不是無腦通過）', async () => {
      const app = createListApp(BASE, null);

      await app.list('todo=true');

      expect(app.inCalls.some((call) => call.column === 'campus_id')).toBe(false);
    });
  });
});

describe('GET /api/academy-exams/todo-by-class —— 每班待登錄一次帶回（#1782）', () => {
  type Row = Record<string, unknown>;
  interface Tables {
    staff: Row[];
    schedules: Row[];
    academy_exams: Row[];
    academy_exam_classes: Row[];
    enrollments: Row[];
    academy_scores: Row[];
  }

  /**
   * 照查詢條件真的過濾的記憶體替身：分校範圍、任課範圍都要**真的少掉列**才紅得起來，
   * 只記「有沒有下 `.in`」的話，下在錯的查詢上也會綠。
   * 巢狀欄位（`classes.org_id`）不看；select 只投影平的欄位名。
   */
  function createApp(
    tables: Tables,
    ctx: { roles: string[]; userId?: string; campusScope?: readonly string[] | null },
  ) {
    const supabase = {
      from(table: keyof Tables) {
        const filters: Array<(row: Row) => boolean> = [];
        let columns = '';
        const run = () => {
          const rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
          const wanted = columns
            .split(',')
            .map((col) => col.trim())
            .filter((col) => /^\w+$/.test(col));
          return rows.map((row) =>
            Object.fromEntries(Object.entries(row).filter(([key]) => wanted.includes(key))),
          );
        };
        const query: Record<string, unknown> = {
          select: (cols: string) => {
            columns = cols;
            return query;
          },
          eq: (col: string, value: unknown) => {
            if (!col.includes('.')) filters.push((row) => row[col] === value);
            return query;
          },
          neq: (col: string, value: unknown) => {
            filters.push((row) => row[col] !== value);
            return query;
          },
          in: (col: string, values: unknown[]) => {
            filters.push((row) => values.includes(row[col]));
            return query;
          },
          maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
          then: (onfulfilled?: (value: unknown) => unknown) =>
            Promise.resolve({ data: run(), error: null }).then(onfulfilled),
        };
        return query;
      },
    };

    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', ctx.userId ?? 'user-admin');
      context.set('roles', ctx.roles);
      context.set('campusScope', ctx.campusScope ?? null);
      await next();
    });
    app.route('/api/academy-exams', academyExamsApp);

    return async (queryString = '') => {
      const response = await app.request(
        `/api/academy-exams/todo-by-class${queryString}`,
        {},
        undefined,
        { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
      );
      return {
        status: response.status,
        body: (await response.json()) as {
          data: Array<{ classId: string; count: number; firstExamId: string }>;
        },
      };
    };
  }

  // A、B 在分校 1（老師 t1 只教 A），C 在分校 2。每班一位學生。
  const exam = (id: string, campus: string, date: string, status = 'active') => ({
    id,
    org_id: 'org-1',
    campus_id: campus,
    exam_date: date,
    status,
  });
  const link = (exam_id: string, class_id: string) => ({ exam_id, class_id });
  const enroll = (class_id: string, student_id: string) => ({
    org_id: 'org-1',
    class_id,
    student_id,
    status: 'active',
    effective_from: '2026-01-01',
    effective_to: null,
  });
  const TABLES: Tables = {
    staff: [{ id: 'staff-t1', user_id: 'user-t1', org_id: 'org-1' }],
    schedules: [{ class_id: 'A', teacher_id: 'staff-t1' }],
    academy_exams: [
      exam('e-late', 'campus-1', '2026-10-01'), // A、B 都沒登
      exam('e-early', 'campus-1', '2026-09-20'), // 只有 A，沒登
      exam('e-done', 'campus-1', '2026-09-10'), // 只有 B，登完了
      exam('e-c2', 'campus-2', '2026-09-01'), // 分校 2 的 C，沒登
      exam('e-closed', 'campus-1', '2026-08-01', 'closed'), // 已結束，不算
    ],
    academy_exam_classes: [
      link('e-late', 'A'),
      link('e-late', 'B'),
      link('e-early', 'A'),
      link('e-done', 'B'),
      link('e-c2', 'C'),
      link('e-closed', 'A'),
    ],
    enrollments: [enroll('A', 's-a'), enroll('B', 's-b'), enroll('C', 's-c')],
    academy_scores: [{ exam_id: 'e-done', student_id: 's-b' }],
  };
  const byClass = (data: Array<{ classId: string }>) =>
    Object.fromEntries(data.map(({ classId, ...rest }) => [classId, rest]));

  it('管理員不受限：每班的待登錄場數＋最早那場；登完的、已結束的不算', async () => {
    const { status, body } = await createApp(TABLES, { roles: ['admin'] })();
    expect(status).toBe(200);
    expect(byClass(body.data)).toEqual({
      A: { count: 2, firstExamId: 'e-early' },
      B: { count: 1, firstExamId: 'e-late' },
      C: { count: 1, firstExamId: 'e-c2' },
    });
  });

  it('別 org 沒登完的考試不進回應 —— 它的班、它的考試 id 都不能回出去（c1）', async () => {
    const tables = {
      ...TABLES,
      academy_exams: [
        ...TABLES.academy_exams,
        { ...exam('e-other-org', 'campus-1', '2026-09-01'), org_id: 'org-2' },
      ],
      academy_exam_classes: [...TABLES.academy_exam_classes, link('e-other-org', 'X')],
      enrollments: [...TABLES.enrollments, enroll('X', 's-x')],
    };
    const { body } = await createApp(tables, { roles: ['admin'] })();
    expect(body.data.map((row) => row.classId).sort()).toEqual(['A', 'B', 'C']);
    expect(body.data.map((row) => row.firstExamId)).not.toContain('e-other-org');
  });

  it('同一天兩場都沒登：firstExamId 取 id 較小的那場，不看 DB 回傳順序', async () => {
    const tables = {
      ...TABLES,
      // 故意讓 id 較大的排前面：沒有 tie-break 就會拿到 e-same-b
      academy_exams: [
        ...TABLES.academy_exams,
        exam('e-same-b', 'campus-1', '2026-09-05'),
        exam('e-same-a', 'campus-1', '2026-09-05'),
      ],
      academy_exam_classes: [
        ...TABLES.academy_exam_classes,
        link('e-same-b', 'D'),
        link('e-same-a', 'D'),
      ],
      enrollments: [...TABLES.enrollments, enroll('D', 's-d')],
    };
    const { body } = await createApp(tables, { roles: ['admin'] })();
    expect(byClass(body.data)['D']).toEqual({ count: 2, firstExamId: 'e-same-a' });
  });

  it('只管分校 1 的管理員看不到分校 2 的班；指名分校 2 也撐不大範圍', async () => {
    const get = createApp(TABLES, { roles: ['admin'], campusScope: ['campus-1'] });
    expect(Object.keys(byClass((await get()).body.data)).sort()).toEqual(['A', 'B']);
    expect((await get('?campus_id=00000000-0000-4000-8000-000000000002')).body.data).toEqual([]);
  });

  it('不受限的管理員指名分校：只回那間分校的班', async () => {
    const tables = {
      ...TABLES,
      academy_exams: TABLES.academy_exams.map((row) =>
        row['campus_id'] === 'campus-2'
          ? { ...row, campus_id: '00000000-0000-4000-8000-000000000002' }
          : row,
      ),
    };
    const { body } = await createApp(tables, { roles: ['admin'] })(
      '?campus_id=00000000-0000-4000-8000-000000000002',
    );
    expect(byClass(body.data)).toEqual({ C: { count: 1, firstExamId: 'e-c2' } });
  });

  it('老師只拿到自己任課的班 —— 同一場考試的別班（B）不回', async () => {
    const { status, body } = await createApp(TABLES, { roles: ['teacher'], userId: 'user-t1' })();
    expect(status).toBe(200);
    expect(byClass(body.data)).toEqual({ A: { count: 2, firstExamId: 'e-early' } });
  });

  it('沒有任課班的老師回空，不是回全部', async () => {
    const tables = { ...TABLES, schedules: [] };
    const { status, body } = await createApp(tables, { roles: ['teacher'], userId: 'user-t1' })();
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('沒有教職員列的老師 403', async () => {
    const { status } = await createApp(TABLES, { roles: ['teacher'], userId: 'user-nobody' })();
    expect(status).toBe(403);
  });
});
