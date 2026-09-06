import { describe, expect, it } from 'vitest';

import { ATTENDANCE_SELECT, flattenAttendanceRow, toAttendanceResponse } from './attendance-query';

/**
 * **停課的課堂在家長端出缺席上，長得跟一次正常的請假一模一樣。**
 *
 * 停課只改 `sessions.status`，那筆 event 與它上面的 `attendance_records` 都留著
 * （請假連動寫的 `on_leave` 尤其常見）。於是家長看到「X/X 數學 A 請假」——
 * 日期、班名、狀態點全部正常，**沒有任何線索說那堂課根本沒上**。
 *
 * 而老師端同一件事有「停課」標籤。**這是矛盾不是缺口**：兩個消費端對同一筆資料
 * 給出不同的說法，而家長沒有任何線索知道自己看到的是退化版。
 *
 * 根因不在畫面：**`ATTENDANCE_SELECT` 根本沒選 session 的 `status`**，所以前端
 * 就算想標也沒有那個欄位 —— **資料在到達畫面之前就已經不完整了。**
 */
describe('ATTENDANCE_SELECT —— 要帶得回 session 的狀態', () => {
  it('select 字串有把 session 的 status 撈回來', () => {
    // 釘住的是「這個欄位有被要」。少了它，下游每一個消費端都只能猜，
    // 而它們會猜出不同的答案（老師端標停課、家長端不標）
    expect(ATTENDANCE_SELECT).toMatch(/sessions\([^)]*\bstatus\b/);
  });

  it('沒有動出勤紀錄自己的 status —— 兩個 status 不能互相蓋掉', () => {
    // `attendance_records.status`（present/absent/on_leave）與
    // `sessions.status`（scheduled/completed/cancelled）是兩個不同的東西，
    // 攤平之後必須是兩個欄位
    expect(ATTENDANCE_SELECT).toMatch(/id, org_id, student_id, event_id, status,/);
  });
});

describe('flattenAttendanceRow / toAttendanceResponse —— 課堂狀態', () => {
  function row(sessionStatus: string | null) {
    return {
      id: 'rec-1',
      org_id: 'org-1',
      student_id: 'stu-1',
      event_id: 'ev-1',
      status: 'on_leave',
      note: null,
      recorded_by: 'user-1',
      recorded_by_role: 'system',
      created_at: '2026-04-06T00:00:00Z',
      updated_at: '2026-04-06T00:00:00Z',
      students: { name: '王小明' },
      events: {
        event_date: '2026-04-06',
        start_time: '18:00',
        end_time: '20:00',
        campuses: { name: '本校' },
        sessions:
          sessionStatus === null
            ? null
            : [{ class_id: 'class-1', status: sessionStatus, classes: { name: '數學 A' } }],
      },
    };
  }

  it('⚠️ 停課的課堂帶得回 cancelled —— 出勤狀態仍然是 on_leave，兩個各自獨立', () => {
    const flat = flattenAttendanceRow(row('cancelled'));
    const response = toAttendanceResponse(flat as unknown as Record<string, unknown>);

    expect(response.sessionStatus).toBe('cancelled');
    // **出勤紀錄自己的 status 不能被蓋掉** —— 這一筆確實是一次請假，
    // 只是那堂課後來停了。兩件事都要說得出來
    expect(response.status).toBe('on_leave');
    expect(response.className).toBe('數學 A');
  });

  it('正常的課堂帶回 scheduled', () => {
    const flat = flattenAttendanceRow(row('scheduled'));
    expect(toAttendanceResponse(flat as unknown as Record<string, unknown>).sessionStatus).toBe(
      'scheduled',
    );
  });

  it('沒有 session 的 event（活動、公告）→ null，不是猜一個值', () => {
    // 回 `'scheduled'` 當預設會讓「這不是課堂」跟「這是一堂正常的課」長得一樣
    const flat = flattenAttendanceRow(row(null));
    const response = toAttendanceResponse(flat as unknown as Record<string, unknown>);

    expect(response.sessionStatus).toBeNull();
    expect(response.className).toBeNull();
  });
});
