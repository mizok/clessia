import { describe, expect, it } from 'vitest';

import { toCsv } from './csv';

const strip = (csv: string) => csv.replace(/^﻿/, '');

describe('toCsv', () => {
  it('第一列是欄位名，之後每列一筆', () => {
    expect(strip(toCsv(['日期', '金額'], [['2026-03-01', 1000]]))).toBe(
      '日期,金額\r\n2026-03-01,1000',
    );
  });

  /**
   * **BOM 是刻意的，而且刻意放在這裡而不是呼叫端。**
   *
   * Excel 開沒有 BOM 的 UTF-8 CSV 會把中文變成亂碼 —— 而這份檔案的欄位全是中文。
   * 放在呼叫端的話它會在某次重構裡被弄丟，然後症狀是「行政說匯出的檔打不開」，
   * 而後端測試全綠。
   */
  it('預設加上 UTF-8 BOM（Excel 沒有它會把中文顯示成亂碼）', () => {
    expect(toCsv(['日期'], [])).toMatch(/^﻿/);
    expect(toCsv(['日期'], [], { bom: false })).not.toMatch(/^﻿/);
  });

  // 逗號是 CSV 的分隔字元 —— 不包起來的話一個欄位會裂成兩欄，而且**不會報錯**
  it('含逗號的欄位要用雙引號包起來', () => {
    expect(strip(toCsv(['備註'], [['台北,信義']]))).toBe('備註\r\n"台北,信義"');
  });

  // 雙引號要 escape 成兩個，否則引號會提前關閉、後面的內容全部錯位
  it('含雙引號的欄位：包起來並把引號變兩個', () => {
    expect(strip(toCsv(['備註'], [['他說「", "」']]))).toBe('備註\r\n"他說「"", ""」"');
  });

  it('含換行的欄位也要包起來', () => {
    expect(strip(toCsv(['備註'], [['第一行\n第二行']]))).toBe('備註\r\n"第一行\n第二行"');
  });

  // null / undefined 要變空字串。印成 "null" 的話行政會以為那是資料
  it('null 與 undefined 變空字串，不是字面的 null', () => {
    expect(strip(toCsv(['a', 'b'], [[null, undefined]]))).toBe('a,b\r\n,');
  });

  it('數字 0 要印出來，不能被當成空值', () => {
    expect(strip(toCsv(['金額'], [[0]]))).toBe('金額\r\n0');
  });

  it('沒有資料時只有表頭 —— 不是空檔案', () => {
    expect(strip(toCsv(['日期', '金額'], []))).toBe('日期,金額');
  });
});
