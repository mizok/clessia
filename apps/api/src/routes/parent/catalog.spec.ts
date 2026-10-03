import { describe, it } from 'vitest';

/**
 * #1118 家長端課程／開課班目錄 —— 驗收條件骨架。設計：kb/wiki/architecture/parent-catalog-read.md
 * （draft，待 STOP 批准）。批准後逐條改成真測試（createChildDb ＋ multi-org-db），先紅再實作。
 */
describe('GET /api/me/catalog', () => {
  describe('範圍', () => {
    it.todo('不是家長身分：403 NOT_PARENT');
    it.todo('childId 不在 scope：403');
    it.todo('只回本 org 的班；別 org 的班不出現（orgRef 帶 org_id）');
    it.todo('停用的班、end_date 已過的班不出現');
    it.todo('孩子今天在籍的班不出現；已結束的舊報名不影響');
  });

  describe('內容', () => {
    it.todo('帶課程名、科目、簡介、分校名、今天仍有效的每週時段、任課老師名（去重）');
    it.todo('remainingSeats = max_students − 佔名額人數（active＋pending_payment），不低於 0');
    it.todo('matchesGrade：孩子年級在 grade_levels，或 grade_levels 為空');
    it.todo('回應不含任何報名列、學生資料、老師 id、next_class_id');
  });
});

describe('childDb.activeEnrollmentCounts', () => {
  it.todo('一次查多班，回 Map<classId, number>；只數 active＋pending_payment；別 org 不算');
  it.todo('classIds 為空：不查 DB，回空 Map');
});
