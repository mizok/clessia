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
                  academy_exam_classes: [
                    {
                      count: fixture.examClasses.filter((row) => row.exam_id === exam.id).length,
                    },
                  ],
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
              result = { data: project(fixture.scores, columns), error: null };
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

    return { list, todoIds: () => todoIdFilter, inCalls };
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
