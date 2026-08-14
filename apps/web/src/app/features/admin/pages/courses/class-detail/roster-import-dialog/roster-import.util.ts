/**
 * Excel 名單匯入的純邏輯 —— 解析與學校名稱正規化。
 *
 * 兩件事在這裡而不是在元件裡：它們是這個功能唯一會出錯的部分，
 * 而且錯的方式都很安靜（配錯欄、對錯學校），必須測得到。
 */

/** batchCreate 的上限。切塊送出會造成部分寫入，所以在解析階段就擋 */
export const MAX_ROSTER_ROWS = 50;

/** 跟家長匯入一致：第 1 列是標題、第 2 列是說明 */
const DATA_START_ROW = 2;

export interface RosterRow {
  readonly index: number;
  readonly name: string;
  readonly school: string;
  readonly error: string | null;
}

export interface SchoolOption {
  readonly id: string;
  readonly name: string;
  readonly shortName: string | null;
}

export interface SchoolMatch {
  /** 名單上原本寫的字 */
  readonly input: string;
  readonly candidates: SchoolOption[];
  /** 只有唯一解時才自動填；多個候選一律交給人挑 */
  readonly resolvedId: string | null;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function parseRosterSheet(sheetRows: unknown[][]): {
  rows: RosterRow[];
  error: string | null;
} {
  const dataRows = sheetRows
    .slice(DATA_START_ROW)
    .map((row) => ({ name: text(row?.[0]), school: text(row?.[1]) }))
    .filter((row) => row.name !== '' || row.school !== '');

  if (dataRows.length > MAX_ROSTER_ROWS) {
    return {
      rows: [],
      error: `一次最多匯入 ${MAX_ROSTER_ROWS} 人，這份名單有 ${dataRows.length} 人，請分批匯入`,
    };
  }

  const rows = dataRows.map((row, i) => ({
    index: i + 1,
    name: row.name,
    school: row.school,
    error: !row.name ? '缺少姓名' : !row.school ? '缺少就讀學校' : null,
  }));

  return { rows, error: null };
}

/**
 * 把名單上的學校寫法對到系統裡的學校。
 *
 * 後端的 batch-match 是拿 `schools.name` 完全相符去查的，而名單上幾乎一定寫簡稱
 * （「文山國中」vs 系統裡的「台北市立文山國中」）—— 不先正規化的話每一列都會 not_found。
 *
 * 雙向包含：名單寫得比較短（簡稱）或比較長（多了縣市）都對得到。
 * 唯一解才自動填，多個候選一律讓人選 —— 猜錯了會把學生配到別間學校，而且沒人看得出來。
 */
export function matchSchoolNames(inputs: string[], schools: SchoolOption[]): SchoolMatch[] {
  const distinct = Array.from(new Set(inputs.map((value) => value.trim()).filter(Boolean)));

  return distinct.map((input) => {
    const needle = input.toLowerCase();
    const exact = schools.filter(
      (school) =>
        school.name.toLowerCase() === needle || (school.shortName ?? '').toLowerCase() === needle,
    );

    const candidates =
      exact.length > 0
        ? exact
        : schools.filter((school) => {
            const name = school.name.toLowerCase();
            const short = (school.shortName ?? '').toLowerCase();
            return (
              name.includes(needle) ||
              needle.includes(name) ||
              (short !== '' && (short.includes(needle) || needle.includes(short)))
            );
          });

    return {
      input,
      candidates,
      resolvedId: candidates.length === 1 ? candidates[0].id : null,
    };
  });
}
