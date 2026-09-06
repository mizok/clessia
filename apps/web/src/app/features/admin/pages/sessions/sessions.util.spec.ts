import { format, parseISO } from 'date-fns';

import { pendingAttendanceQuery } from '../dashboard/dashboard.util';
import { parseAttendanceQueryParams } from './sessions.util';

// `new Date('2026-08-22')`（無時分秒的 ISO 字串）是 UTC 解讀，UTC+8 印出來會差一天——
// 跟實作一樣用 `parseISO`（本地時區）組期望值，不要在測試裡踩自己在別處警告過的坑
describe('parseAttendanceQueryParams', () => {
  it('三個必要欄位都在、沒帶 endedOnly 時解出完整篩選，endedOnly 預設 false', () => {
    const result = parseAttendanceQueryParams({
      dateFrom: '2026-08-22',
      dateTo: '2026-08-29',
      attendanceTaken: 'false',
    });

    expect(result).toEqual({
      dateFrom: parseISO('2026-08-22'),
      dateTo: parseISO('2026-08-29'),
      attendanceTaken: false,
      endedOnly: false,
      statuses: null,
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

  it('endedOnly=true 解成布林 true，不是字串', () => {
    expect(
      parseAttendanceQueryParams({
        dateFrom: '2026-08-22',
        dateTo: '2026-08-29',
        attendanceTaken: 'false',
        endedOnly: 'true',
      })?.endedOnly,
    ).toBe(true);
  });

  it('缺日期時整組不採用（不是半套帶著錯的範圍篩）', () => {
    expect(parseAttendanceQueryParams({ attendanceTaken: 'false' })).toBeNull();
  });

  it('缺 attendanceTaken 時整組不採用', () => {
    expect(parseAttendanceQueryParams({ dateFrom: '2026-08-22', dateTo: '2026-08-29' })).toBeNull();
  });

  // endedOnly 不在「缺一不可」名單裡——它是可選加強條件，缺它不影響其餘三個欄位是否成立
  it('缺 endedOnly 不影響其餘篩選成立，只是預設 false', () => {
    const result = parseAttendanceQueryParams({
      dateFrom: '2026-08-22',
      dateTo: '2026-08-29',
      attendanceTaken: 'true',
    });

    expect(result).not.toBeNull();
    expect(result?.endedOnly).toBe(false);
  });

  it('沒有任何 query params 時回傳 null', () => {
    expect(parseAttendanceQueryParams({})).toBeNull();
  });

  it('statuses 逗號串解成陣列', () => {
    expect(
      parseAttendanceQueryParams({
        dateFrom: '2026-08-22',
        dateTo: '2026-08-29',
        attendanceTaken: 'false',
        statuses: 'scheduled,completed',
      })?.statuses,
    ).toEqual(['scheduled', 'completed']);
  });

  // `null`（沒帶）與 `[]`（有帶但空的）必須分得開——落地頁只在 `null` 時
  // 退回自己的 `DEFAULT_STATUSES`。壓成同一個值的話，「使用者一個狀態都不選」
  // 會被悄悄改寫成預設篩選，而畫面上看不出被改寫過
  it('沒帶 statuses 是 null，帶了空字串是空陣列 —— 兩者不同', () => {
    const base = { dateFrom: '2026-08-22', dateTo: '2026-08-29', attendanceTaken: 'false' };
    expect(parseAttendanceQueryParams(base)?.statuses).toBeNull();
    expect(parseAttendanceQueryParams({ ...base, statuses: '' })?.statuses).toEqual([]);
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
      statuses: query.statuses.join(','),
    };
  }

  it('儀表板送出的 queryParams，課堂管理頁解出來的日期、attendanceTaken 與 endedOnly 跟原始查詢語意相等', () => {
    const dashboardQuery = pendingAttendanceQuery(NOW, 7);
    const routeParams = toRouteQueryParams(dashboardQuery);

    const parsed = parseAttendanceQueryParams(routeParams);

    expect(parsed).not.toBeNull();
    expect(format(parsed!.dateFrom, 'yyyy-MM-dd')).toBe(dashboardQuery.dateFrom);
    expect(format(parsed!.dateTo, 'yyyy-MM-dd')).toBe(dashboardQuery.dateTo);
    expect(parsed!.attendanceTaken).toBe(dashboardQuery.attendanceTaken);
    // 這條在 endedOnly 補上 GET /api/sessions 支援之前一直是缺口——
    // dashboard 帶了 endedOnly=true，落地頁解析卻沒有回傳它，這條測試原本
    // 不會抓到，因為根本沒斷言到這個欄位
    expect(parsed!.endedOnly).toBe(dashboardQuery.endedOnly);
    // `statuses` 是同一個缺口的下一個成員（#456）：儀表板的數字吃 API 預設、
    // 落地頁吃 web 的 `DEFAULT_STATUSES`，**兩份獨立的清單今天剛好相等**。
    // 上面那條 `endedOnly` 的註解講的是「沒斷言到就抓不到」——一模一樣的道理，
    // 差別只在這次是兩個預設值而不是一個漏掉的欄位
    expect(parsed!.statuses).toEqual(dashboardQuery.statuses);
  });

  // 陷阱：如果有人把 dashboard 那邊的 dateTo 改回「昨天」（回到拆兩段查以前的寫法），
  // 這裡解出來的 dateTo 也會跟著變成昨天——證明這條測試真的在追蹤 dashboard 的輸出，
  // 不是巧合通過。跟 dashboard.util.spec.ts 的同款陷阱測試是同一件事的兩端。
  it('陷阱：dateTo 若不是今天，解析結果會忠實反映出來（不會被悄悄修正）', () => {
    const dashboardQuery = pendingAttendanceQuery(NOW, 7);
    const parsed = parseAttendanceQueryParams(toRouteQueryParams(dashboardQuery));

    expect(format(parsed!.dateTo, 'yyyy-MM-dd')).toBe(format(NOW, 'yyyy-MM-dd'));
  });

  // 陷阱：把 dashboard 的 statuses 換成別的清單，落地頁解出來的要跟著換。
  // 這條擋的是「落地頁其實沒讀這個參數、只是自己的預設剛好相等」——
  // 那正是 #456 的原狀，而它在測試上跟修好之後**長得一模一樣**
  it('陷阱：dashboard 換一組 statuses，落地頁解出來的跟著換（不是各用各的預設值）', () => {
    const parsed = parseAttendanceQueryParams({
      ...toRouteQueryParams(pendingAttendanceQuery(NOW, 7)),
      statuses: 'scheduled',
    });

    expect(parsed!.statuses).toEqual(['scheduled']);
  });
});
