import { describe, it } from 'vitest';

/**
 * #1116 家長端「孩子的課堂」—— 驗收條件骨架。設計：kb/wiki/architecture/parent-sessions-read.md
 * （draft，待 STOP 批准）。批准後照這份逐條改成真測試（真的 createChildDb ＋ multi-org-db），先紅再實作。
 */
describe('GET /api/me/sessions', () => {
  describe('範圍', () => {
    it.todo('不是家長身分：403 NOT_PARENT');
    it.todo('childId 不在 scope：403（指名越權回 403，不回空）');
    it.todo('dateFrom／dateTo 缺一或區間超過 42 天：400');
    it.todo('只回這個孩子報名過的班的堂；別 org、別的班的堂不出現');
    it.todo('轉班：A 班在 effective_to 之後、B 班在 effective_from 之前的堂不出現（countEnrolledOn）');
  });

  describe('內容', () => {
    it.todo('帶課程名、班名、分校名、上課老師；代課時 isSubstitute = true（isSubstituteSession）');
    it.todo('同班同日有校內考：examCount 為場數（countExamsBySession，不看 status）');
    it.todo('有課務異動：changes[] 帶改期／代課／停課的說明');
    it.todo('停課的堂照樣回，status = cancelled（待裁 1）');
    it.todo('attendance 只是這個孩子的那一筆；沒點名的未來堂 attendance = null');
    it.todo('回應不含全班人數、其他學生的任何資料');
  });
});
