import { describe, it } from 'vitest';

/**
 * #1114 請假綁定堂次 —— 驗收條件骨架。設計：kb/wiki/architecture/leave-session-binding.md
 * （draft，待 STOP 批准）。批准後逐條改成真測試（multi-org-db），先紅再實作。
 */
describe('leaveCoversSession —— 綁定堂次', () => {
  it.todo('有綁定：只蓋綁定的堂，同日其他堂不蓋，不看日期區間與時間窗');
  it.todo('沒綁定：沿用舊語意（整天；單日時間窗做重疊）');
});

describe('POST /api/leaves —— sessionIds', () => {
  it.todo('寫入假單＋綁定列，start_date／end_date 由綁定堂次算出、不吃 body');
  it.todo('只對綁定的堂寫 on_leave，同日其他堂不動');
  it.todo('別 org 的堂：400（c1），不寫任何列');
  it.todo('學生那天不在籍的堂、停課的堂：400 並指名哪一堂');
  it.todo('sessionIds 與 startTime／endTime 同時給：400');
  it.todo('沒綁定的單日時間窗假：on_leave 只寫時間重疊的堂（修 applyLeaveAttendance 與推導的分岔）');
  it.todo('分校範圍外的學生：403（studentWriteScope 照舊）');
});

describe('PATCH /api/leaves/:id —— 綁定替換', () => {
  it.todo('新增的堂 apply on_leave、拿掉的堂 revert（已點名的 event 不動）');
  it.todo('沒給 sessionIds：綁定不變');
});

describe('DELETE /api/leaves/:id —— 綁定型', () => {
  it.todo('綁定列 cascade，revert 只回綁定的堂');
});

describe('待裁項（批准後依裁定補）', () => {
  it.todo('cancel-leave：綁定型只移除當天綁定列，剩零列才刪單');
  it.todo('日到班 onLeave：當天任一堂被蓋到就算');
  it.todo('報名回補（#568）：綁定型不回補到新班');
  it.todo('重疊 409：綁定型只在共用同一堂時衝突；與整天型同日衝突');
});
