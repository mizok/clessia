import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import * as studentsRoute from './students';

describe('buildStudentSummary', () => {
  it('counts active students from rows', () => {
    const buildStudentSummary = (studentsRoute as Record<string, unknown>)[
      'buildStudentSummary'
    ] as
      | ((
          rows: Array<{ is_active: boolean }>,
          total: number,
        ) => {
          total: number;
          activeCount: number;
        })
      | undefined;

    expect(buildStudentSummary).toBeTypeOf('function');

    const result = buildStudentSummary?.(
      [{ is_active: true }, { is_active: false }, { is_active: true }],
      3,
    );

    expect(result).toEqual({ total: 3, activeCount: 2 });
  });
});

describe('toStudentResponse', () => {
  it('maps snake_case DB row to camelCase response', () => {
    const toStudentResponse = (studentsRoute as Record<string, unknown>)['toStudentResponse'] as
      | ((row: Record<string, unknown>, parentNames?: string[]) => Record<string, unknown>)
      | undefined;

    expect(toStudentResponse).toBeTypeOf('function');

    const row = {
      id: 'abc-123',
      org_id: 'org-456',
      name: '林子璿',
      grade: 'J1',
      schools: {
        id: 'school-1',
        name: '台北市立文山國中',
        short_name: '文山',
      },
      birthday: '2010-05-15',
      gender: 'male',
      phone: null,
      address: null,
      emergency_contact_name: '林志明',
      emergency_contact_phone: '0912345678',
      notes: null,
      is_active: true,
      created_at: '2026-03-16T00:00:00Z',
      updated_at: '2026-03-16T00:00:00Z',
    };

    const result = toStudentResponse?.(row, ['林志明']);

    expect(result).toMatchObject({
      id: 'abc-123',
      orgId: 'org-456',
      name: '林子璿',
      grade: 'J1',
      school: {
        id: 'school-1',
        name: '台北市立文山國中',
        shortName: '文山',
      },
      birthday: '2010-05-15',
      gender: 'male',
      emergencyContactName: '林志明',
      emergencyContactPhone: '0912345678',
      isActive: true,
      parentNames: ['林志明'],
    });
  });

  it('handles null optional fields', () => {
    const toStudentResponse = (studentsRoute as Record<string, unknown>)['toStudentResponse'] as
      | ((row: Record<string, unknown>, parentNames?: string[]) => Record<string, unknown>)
      | undefined;

    const row = {
      id: 'abc-123',
      org_id: 'org-456',
      name: '林子璿',
      grade: 'J1',
      schools: null,
      birthday: null,
      gender: null,
      phone: null,
      address: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      notes: null,
      is_active: false,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    const result = toStudentResponse?.(row);

    expect(result?.['birthday']).toBeNull();
    expect(result?.['gender']).toBeNull();
    expect(result?.['school']).toBeNull();
    expect(result?.['emergencyContactName']).toBeNull();
    expect(result?.['parentNames']).toEqual([]);
  });
});

describe('buildStudentSearchClause', () => {
  it('uses student name only when search scope is student_name', () => {
    const buildStudentSearchClause = (studentsRoute as Record<string, unknown>)[
      'buildStudentSearchClause'
    ] as
      ((search: string, matchedStudentIds: string[], searchScope?: string) => string) | undefined;

    expect(buildStudentSearchClause).toBeTypeOf('function');
    expect(buildStudentSearchClause?.('劉', ['student-1'], 'student_name')).toBe('name.ilike.%劉%');
  });

  it('includes parent matches in default scope', () => {
    const buildStudentSearchClause = (studentsRoute as Record<string, unknown>)[
      'buildStudentSearchClause'
    ] as
      ((search: string, matchedStudentIds: string[], searchScope?: string) => string) | undefined;

    expect(buildStudentSearchClause?.('劉', ['student-1'], 'default')).toBe(
      'name.ilike.%劉%,id.in.(student-1)',
    );
  });
});

/**
 * 分校歸屬的語意守衛（#438 裁決，`kb/wiki/rules/enrollment-rules.md` 第 8 節）。
 *
 * **這組測試釘的是一個「刻意不濾」的決定**，而那種決定在程式碼裡長得跟漏寫一模一樣 ——
 * #438 的工單本身就是把它讀成 bug 開出來的。裁決之後只補了文件與註解，那只擋得住
 * 「願意停下來讀的人」；下一個人若把 `campusNames` 也加上 status 過濾，**沒有任何東西
 * 會紅**。所以規則要放在守護點旁邊：改壞就紅，而不是靠 review 抓。
 *
 * 為什麼打整支 handler 而不是測純函式：這條規則活在 handler 的 map 裡（`campusNames` /
 * `classNames` 兩段推導都不是 exported 函式），而 charter 那條「驗證要打到出錯的那一層」
 * 已經數到第七次 —— 抽一支純函式出來測，測的是抽出來的那份，不是路由實際跑的那份。
 *
 * 同一筆資料同時斷言兩個方向（**同形輸入、相反輸出**）：同一張 `withdrawal` 報名
 * **要**出現在 `campusNames`、**不要**出現在 `classNames`。只斷言其中一邊的話，
 * 「兩處都不濾」與「兩處都濾」各有一種寫法可以矇混過關。
 */
describe('GET /api/students —— 退班報名仍算分校歸屬，但不算在籍班級（#438）', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';

  function studentRow() {
    return {
      id: '00000000-0000-0000-0000-0000000000c1',
      org_id: ORG,
      name: '王小明',
      grade: 'G7',
      schools: null,
      birthday: null,
      gender: null,
      phone: null,
      email: null,
      address: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      notes: null,
      is_active: true,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
      parent_student_relations: [],
      enrollments: [
        {
          id: 'e-withdrawn',
          status: 'withdrawal',
          classes: {
            id: 'c-1',
            name: '國一數學A',
            campus_id: 'campus-1',
            campuses: { name: '中正分校' },
          },
        },
        {
          id: 'e-active',
          status: 'active',
          classes: {
            id: 'c-2',
            name: '國一英文B',
            campus_id: 'campus-2',
            campuses: { name: '大安分校' },
          },
        },
      ],
    };
  }

  /** 只實作這支 handler 用到的鏈：select/eq/order/range 各自回自己，await 時給資料 */
  function fakeSupabase(rows: ReturnType<typeof studentRow>[]) {
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;
    Object.assign(builder, {
      select: () => chain(),
      eq: () => chain(),
      in: () => chain(),
      or: () => chain(),
      order: () => chain(),
      range: () => chain(),
      // 查詢是被 `await` 的（不是靠最後一個方法回 Promise），所以替身要是 thenable
      then: (resolve: (value: { data: unknown; count: number; error: null }) => unknown) =>
        resolve({ data: rows, count: rows.length, error: null }),
    });

    return { from: () => builder };
  }

  async function listStudents() {
    const client = fakeSupabase([studentRow()]);
    const app = new Hono();
    app.use('*', async (c, next) => {
      // 裸 Hono 沒有 AppEnv 的 Variables 型別，照 invoices.spec.ts 的先例轉一次
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', client);
      set('orgId', ORG);
      set('userId', 'user-1');
      // admin —— 讓 resolveStudentScope 回不縮限的範圍，這組測的是 campusNames 不是授權
      set('roles', ['admin']);
      set('campusScope', null);
      await next();
    });
    app.route('/', studentsRoute.default as unknown as Hono);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ campusNames: string[]; classNames: string[]; hasEnrollments: boolean }>;
    };

    return body.data[0];
  }

  it('withdrawal 的分校**留在** campusNames —— 退班學生對分校主任是現在進行式的工作對象', async () => {
    const student = await listStudents();

    // 中正分校那筆報名已經 withdrawal，但分校歸屬看的是「這個分校收過他」
    expect(student.campusNames).toEqual(['中正分校', '大安分校']);
  });

  it('同一筆 withdrawal 的班名**不在** classNames —— 在籍才算，兩個欄位刻意相反', async () => {
    const student = await listStudents();

    expect(student.classNames).toEqual(['國一英文B']);
    // 同形輸入、相反輸出：同一張報名在上一條要出現、在這條不能出現。
    // 兩條一起才排除得掉「兩處都濾」與「兩處都不濾」這兩種一致但錯的實作
    expect(student.classNames).not.toContain('國一數學A');
  });

  it('hasEnrollments 也不濾 —— 它是刪除守門，退班的報名一樣是引用', async () => {
    const student = await listStudents();

    expect(student.hasEnrollments).toBe(true);
  });
});
