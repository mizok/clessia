import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import catalogRoute from './catalog';

/**
 * #1118 家長端課程／開課班目錄。設計：kb/wiki/architecture/parent-catalog-read.md。
 * 真的 `createChildDb` ＋ 會照條件過濾的 multi-org-db：要證明 org 條件與名額聚合真的有下。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CHILD = id(1);
const STRANGER = id(2);
const OTHER_STUDENT = id(3);

const CLS_MATH = id(11);
const CLS_ENG = id(12);
const CLS_ENROLLED = id(13);
const CLS_INACTIVE = id(14);
const CLS_ENDED = id(15);
const CLS_ORG_B = id(16);
const CLS_OLD = id(17); // 孩子以前讀過、已結束的報名

const TODAY = '2026-10-03';

function cls(cid: string, extra: Record<string, unknown> = {}) {
  return {
    id: cid,
    org_id: ORG,
    name: `班 ${cid.slice(-2)}`,
    grade_levels: [],
    max_students: 10,
    is_active: true,
    end_date: null,
    next_class_id: null,
    courses: {
      id: 'course-1',
      name: '國中數學',
      description: '會考衝刺',
      subjects: { name: '數學' },
    },
    campuses: { name: '信義校' },
    schedules: [
      {
        weekday: 2,
        start_time: '18:00:00',
        end_time: '20:00:00',
        teacher_id: 't-1',
        effective_to: null,
        teacher: { display_name: '王老師' },
      },
      {
        weekday: 4,
        start_time: '18:00:00',
        end_time: '20:00:00',
        teacher_id: 't-1',
        effective_to: '2026-09-30', // 已失效的時段
        teacher: { display_name: '林老師' },
      },
    ],
    ...extra,
  };
}

function enrollment(student: string, classId: string, extra: Record<string, unknown> = {}) {
  return {
    org_id: ORG,
    student_id: student,
    class_id: classId,
    status: 'active',
    effective_from: '2026-01-01',
    effective_to: null,
    ...extra,
  };
}

/** `extra`：逐班覆寫欄位（`db.rows()` 回的是複本，改它不會進替身） */
function seed(extra: Record<string, Record<string, unknown>> = {}) {
  return createMultiOrgDb({
    students: [{ id: CHILD, org_id: ORG, grade: 'junior_2' }],
    classes: [
      cls(CLS_MATH, { grade_levels: ['junior_2', 'junior_3'], ...extra[CLS_MATH] }),
      cls(CLS_ENG, { grade_levels: ['senior_1'], max_students: 2, ...extra[CLS_ENG] }),
      cls(CLS_ENROLLED),
      cls(CLS_INACTIVE, { is_active: false }),
      cls(CLS_ENDED, { end_date: '2026-09-30' }),
      cls(CLS_ORG_B, { org_id: ORG_B }),
      cls(CLS_OLD, extra[CLS_OLD]),
    ],
    enrollments: [
      enrollment(CHILD, CLS_ENROLLED),
      enrollment(CHILD, CLS_OLD, { effective_to: '2026-06-30' }),
      enrollment(OTHER_STUDENT, CLS_ENG),
      enrollment(STRANGER, CLS_ENG, { status: 'pending_payment' }),
      enrollment(id(4), CLS_ENG, { status: 'withdrawn' }),
      enrollment(id(5), CLS_ENG, { org_id: ORG_B }),
    ],
  });
}

function appWith(
  db: ReturnType<typeof createMultiOrgDb>,
  opts: { roles?: string[]; scope?: readonly string[] } = {},
) {
  const scope = opts.scope ?? [CHILD];
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', opts.roles ?? ['parent']);
    set('studentScope', scope);
    set('childDb', createChildDb(db.client as never, scope, ORG));
    await next();
  });
  app.route('/', catalogRoute as unknown as Hono);
  return app;
}

async function get(app: Hono, childId = CHILD) {
  const res = await app.request(`/?childId=${childId}`);
  return { res, body: (await res.json()) as any };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T04:00:00Z`));
});
afterEach(() => vi.useRealTimers());

describe('GET /api/me/catalog', () => {
  describe('範圍', () => {
    it('不是家長身分：403 NOT_PARENT', async () => {
      const { res, body } = await get(appWith(seed(), { roles: ['teacher'] }));
      expect(res.status).toBe(403);
      expect(body.code).toBe('NOT_PARENT');
    });

    it('childId 不在 scope：403', async () => {
      const { res, body } = await get(appWith(seed()), STRANGER);
      expect(res.status).toBe(403);
      expect(body.code).toBe('CHILD_OUT_OF_SCOPE');
    });

    // #1727 Q5 (a)：孩子已在班上的**也回**、標 enrolled（報名頁要「列出但不能選、寫原因」，A6 p-enrollment）；
    // 加選、試聽頁在前端濾掉。已結束的舊報名不算在班上
    it('只回本 org、啟用中、未結束的班；孩子今天在籍的標 enrolled，已結束的舊報名不算', async () => {
      const { res, body } = await get(appWith(seed()));
      expect(res.status).toBe(200);
      const enrolled = Object.fromEntries(
        body.data.map((c: { classId: string; enrolled: boolean }) => [c.classId, c.enrolled]),
      );
      expect(enrolled).toEqual({
        [CLS_MATH]: false,
        [CLS_ENG]: false,
        [CLS_ENROLLED]: true,
        [CLS_OLD]: false,
      });
    });

    /**
     * #1243：課程停用＝正在收掉（管理端不能再開新班、排未來課，COURSE_INACTIVE），
     * 家長加選頁不該再推它底下的班。公開目錄（#1241）同一條。
     */
    it('課程已停用的班不回（班本身還是啟用中）', async () => {
      const { body } = await get(
        appWith(
          seed({ [CLS_OLD]: { courses: { id: 'course-x', name: '舊課', is_active: false } } }),
        ),
      );

      expect(body.data.map((c: { classId: string }) => c.classId).sort()).toEqual(
        [CLS_MATH, CLS_ENG, CLS_ENROLLED].sort(),
      );
    });
  });

  // #1727 Q5 (a)：A6 p-add-course「直接標出撞時間的班」—— 用孩子今天在籍的班、今天仍有效的時段算
  describe('conflictsWith', () => {
    const slot = (
      weekday: number,
      start: string,
      end: string,
      effective_to: string | null = null,
    ) => ({
      weekday,
      start_time: start,
      end_time: end,
      teacher_id: 't-1',
      effective_to,
      teacher: { display_name: '王老師' },
    });
    const conflicts = async () => {
      const { body } = await get(
        appWith(
          seed({
            // 在籍的班 CLS_ENROLLED 用預設：週二 18–20（有效）、週四 18–20（已失效）
            // 兩個時段、只有第二段（排序後）撞：不能只比第一個時段
            [CLS_MATH]: {
              schedules: [slot(1, '10:00:00', '12:00:00'), slot(2, '19:00:00', '21:00:00')],
            },
            // 接著上（我的班之前 16–18、之後 20–21，兩個方向）、撞的是已失效時段 → 都不算
            [CLS_ENG]: {
              schedules: [
                slot(2, '16:00:00', '18:00:00'),
                slot(2, '20:00:00', '21:00:00'),
                slot(4, '18:00:00', '20:00:00'),
              ],
            },
            // 舊報名（已結束）的班當作別的班：它的時段不該算孩子的課
            [CLS_OLD]: { schedules: [slot(2, '17:00:00', '18:30:00')] },
          }),
        ),
      );
      return Object.fromEntries(
        body.data.map((c: { classId: string; conflictsWith: string | null }) => [
          c.classId,
          c.conflictsWith,
        ]),
      );
    };

    it('時段重疊 → 回撞到的在籍班名；接著上、撞到已失效時段 → null；在籍的班自己 → null', async () => {
      const result = await conflicts();
      expect(result[CLS_MATH]).toBe('班 13');
      expect(result[CLS_ENG]).toBeNull();
      expect(result[CLS_ENROLLED]).toBeNull();
    });

    it('已結束的舊報名不算孩子現在的課：別的班跟它撞不標', async () => {
      const { body } = await get(
        appWith(
          seed({
            [CLS_MATH]: { schedules: [slot(6, '10:00:00', '12:00:00')] },
            [CLS_OLD]: { schedules: [slot(6, '10:00:00', '12:00:00')] },
          }),
        ),
      );
      const math = body.data.find((c: { classId: string }) => c.classId === CLS_MATH);
      expect(math.conflictsWith).toBeNull();
    });

    it('舊報名的班本身撞到在籍班時照標（它對孩子是可加選的班）', async () => {
      const result = await conflicts();
      expect(result[CLS_OLD]).toBe('班 13');
    });
  });

  describe('內容', () => {
    it('帶課程、分校、今天仍有效的時段、任課老師（去重）', async () => {
      const { body } = await get(appWith(seed()));
      const math = body.data.find((c: { classId: string }) => c.classId === CLS_MATH);
      expect(math).toEqual({
        classId: CLS_MATH,
        className: '班 11',
        gradeLevels: ['junior_2', 'junior_3'],
        courseId: 'course-1',
        courseName: '國中數學',
        subject: '數學',
        courseDescription: '會考衝刺',
        campusName: '信義校',
        slots: [{ weekday: 2, startTime: '18:00', endTime: '20:00', effectiveFrom: null }],
        teacherNames: ['王老師'],
        maxStudents: 10,
        remainingSeats: 10,
        matchesGrade: true,
        fee: null,
        isRecommended: false,
        enrolled: false,
        // 預設時段都是週二 18–20，跟在籍的 CLS_ENROLLED 撞
        conflictsWith: '班 13',
      });
    });

    it('remainingSeats = max_students − 佔名額人數（active＋pending_payment，本 org），不低於 0', async () => {
      const { body } = await get(appWith(seed()));
      const eng = body.data.find((c: { classId: string }) => c.classId === CLS_ENG);
      expect(eng.remainingSeats).toBe(0);
    });

    it('matchesGrade：年級不在 grade_levels 是 false、空陣列是 true', async () => {
      const { body } = await get(appWith(seed()));
      const byId = new Map(body.data.map((c: { classId: string }) => [c.classId, c]));
      expect((byId.get(CLS_ENG) as { matchesGrade: boolean }).matchesGrade).toBe(false);
      expect((byId.get(CLS_OLD) as { matchesGrade: boolean }).matchesGrade).toBe(true);
    });

    /**
     * #1175：費用取自班級的預設範本（`classes.default_fee_template_id`），只是參考價 ——
     * 實際報名價以報名時選的範本為準。停用的範本不再對外報價。
     */
    it('fee：有預設範本回金額＋計費模式；沒設、或範本已停用回 null', async () => {
      const db = seed({
        [CLS_MATH]: { fee_template: { amount: 4500, billing_mode: 'monthly', is_active: true } },
        [CLS_OLD]: { fee_template: { amount: 9000, billing_mode: 'period', is_active: false } },
      });
      const { body } = await get(appWith(db));
      const feeOf = (cid: string) =>
        body.data.find((c: { classId: string }) => c.classId === cid).fee;

      expect(feeOf(CLS_MATH)).toEqual({ amount: 4500, billingMode: 'monthly' });
      expect(feeOf(CLS_OLD)).toBeNull();
      expect(feeOf(CLS_ENG)).toBeNull();
    });

    /** #1118：推薦是班級的人工標記；規格「推薦加選的優先顯示」→ 排在最前，其餘照課程名→班名 */
    it('isRecommended：照標記回，而且推薦的排最前', async () => {
      const { body } = await get(appWith(seed({ [CLS_OLD]: { is_recommended: true } })));

      expect(body.data[0]).toMatchObject({ classId: CLS_OLD, isRecommended: true });
      expect(body.data.slice(1).every((c: { isRecommended: boolean }) => !c.isRecommended)).toBe(
        true,
      );
    });

    it('回應不含報名列、學生資料、老師 id、next_class_id、範本 id', async () => {
      const { body } = await get(appWith(seed()));
      const keys = Object.keys(body.data[0]);
      for (const leaked of ['enrollments', 'teacherId', 'nextClassId', 'defaultFeeTemplateId']) {
        expect(keys).not.toContain(leaked);
      }
    });
  });
});

describe('childDb.activeEnrollmentCounts', () => {
  it('一次查多班，只數 active＋pending_payment、只數本 org', async () => {
    const childDb = createChildDb(seed().client as never, [CHILD], ORG);
    const { counts, error } = await childDb.activeEnrollmentCounts([CLS_ENG, CLS_MATH]);
    expect(error).toBeNull();
    expect(counts.get(CLS_ENG)).toBe(2);
    expect(counts.get(CLS_MATH) ?? 0).toBe(0);
  });

  it('classIds 為空：回空 Map', async () => {
    const childDb = createChildDb(seed().client as never, [CHILD], ORG);
    expect((await childDb.activeEnrollmentCounts([])).counts.size).toBe(0);
  });
});
