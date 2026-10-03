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

    it('只回本 org、啟用中、未結束、孩子今天沒在籍的班；已結束的舊報名不影響', async () => {
      const { res, body } = await get(appWith(seed()));
      expect(res.status).toBe(200);
      expect(body.data.map((c: { classId: string }) => c.classId).sort()).toEqual(
        [CLS_MATH, CLS_ENG, CLS_OLD].sort(),
      );
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
        [CLS_MATH, CLS_ENG].sort(),
      );
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
        slots: [{ weekday: 2, startTime: '18:00', endTime: '20:00' }],
        teacherNames: ['王老師'],
        maxStudents: 10,
        remainingSeats: 10,
        matchesGrade: true,
        fee: null,
        isRecommended: false,
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
