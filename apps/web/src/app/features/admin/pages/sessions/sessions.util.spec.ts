import { format, parseISO } from 'date-fns';

import { pendingAttendanceQuery } from '../dashboard/dashboard.util';
import { parseAttendanceQueryParams } from './sessions.util';

// `new Date('2026-08-22')`（無時分秒的 ISO 字串）是 UTC 解讀，UTC+8 印出來會差一天——
// 跟實作一樣用 `parseISO`（本地時區）組期望值，不要在測試裡踩自己在別處警告過的坑
describe('parseAttendanceQueryParams', () => {
  it('三個欄位都在時解出完整篩選', () => {
    const result = parseAttendanceQueryParams({
      dateFrom: '2026-08-22',
      dateTo: '2026-08-29',
      attendanceTaken: 'false',
    });

    expect(result).toEqual({
      dateFrom: parseISO('2026-08-22'),
      dateTo: parseISO('2026-08-29'),
      attendanceTaken: false,
    });
  });

  it('attendanceTaken=true 解成布林 true，不是字串', () => {
    expect(
      parseAttendanceQueryParams({
        dateFrom: '2026-08-22',
        dateTo: '2026-08-29',
        attendanceTaken: 'true',
      })?.attendanceTaken,
    ).toBe(true);
  });

  it('缺日期時整組不採用（不是半套帶著錯的範圍篩）', () => {
    expect(parseAttendanceQueryParams({ attendanceTaken: 'false' })).toBeNull();
  });

  it('缺 attendanceTaken 時整組不採用', () => {
    expect(parseAttendanceQueryParams({ dateFrom: '2026-08-22', dateTo: '2026-08-29' })).toBeNull();
  });

  it('沒有任何 query params 時回傳 null', () => {
    expect(parseAttendanceQueryParams({})).toBeNull();
  });
});

/**
 * **契約測試：穿過翻譯層，兩邊不能是同一個值跟它自己比。**
 *
 * 左邊是儀表板算數字＋組 `queryParams` 用的 `pendingAttendanceQuery`（見
 * dashboard.component.ts 怎麼把它的欄位字串化塞進 `StatCard.queryParams`）；
 * 右邊是這支檔案的 `parseAttendanceQueryParams`，也就是課堂管理頁真的會執行
 * 的解析邏輯。中間的字串化／反字串化就是「翻譯層」——任一邊改了参数名稱、
 * 型別、或這個字串化的規則而沒有同步改另一邊，這條測試會紅。
 */
describe('跨頁契約：儀表板的 queryParams 跟課堂管理頁解出來的篩選必須語意相等', () => {
  const NOW = new Date('2026-08-29T12:00:00');

  /** 複製 dashboard.component.ts 組 `StatCard.queryParams` 的那段字串化邏輯 */
  function toRouteQueryParams(query: ReturnType<typeof pendingAttendanceQuery>) {
    return {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      attendanceTaken: String(query.attendanceTaken),
      endedOnly: String(query.endedOnly),
    };
  }

  it('儀表板送出的 queryParams，課堂管理頁解出來的日期與 attendanceTaken 跟原始查詢語意相等', () => {
    const dashboardQuery = pendingAttendanceQuery(NOW, 7);
    const routeParams = toRouteQueryParams(dashboardQuery);

    const parsed = parseAttendanceQueryParams(routeParams);

    expect(parsed).not.toBeNull();
    expect(format(parsed!.dateFrom, 'yyyy-MM-dd')).toBe(dashboardQuery.dateFrom);
    expect(format(parsed!.dateTo, 'yyyy-MM-dd')).toBe(dashboardQuery.dateTo);
    expect(parsed!.attendanceTaken).toBe(dashboardQuery.attendanceTaken);
  });

  // 陷阱：如果有人把 dashboard 那邊的 dateTo 改回「昨天」（回到拆兩段查以前的寫法），
  // 這裡解出來的 dateTo 也會跟著變成昨天——證明這條測試真的在追蹤 dashboard 的輸出，
  // 不是巧合通過。跟 dashboard.util.spec.ts 的同款陷阱測試是同一件事的兩端。
  it('陷阱：dateTo 若不是今天，解析結果會忠實反映出來（不會被悄悄修正）', () => {
    const dashboardQuery = pendingAttendanceQuery(NOW, 7);
    const parsed = parseAttendanceQueryParams(toRouteQueryParams(dashboardQuery));

    expect(format(parsed!.dateTo, 'yyyy-MM-dd')).toBe(format(NOW, 'yyyy-MM-dd'));
  });
});
