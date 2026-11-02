/** 年級 key（同 `students.grade`、`courses.grade_levels`，見 `lib/grade-promotion.ts` 的 Grade） */
export const GRADE_KEYS = [
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'J1',
  'J2',
  'J3',
  'S1',
  'S2',
  'S3',
] as const;

/**
 * 班級的適用年級（#2089）：班級自己有填就用自己的，沒填退回課程的；兩個都沒有＝不限（空陣列）。
 * 管理端（`routes/classes.ts`）與家長目錄的 matchesGrade（`routes/parent/catalog.ts`）共用（計畫席 11-02 裁定）。
 * `classes.grade_levels` 在 20260225 那次搬到課程之前存的是中文（「國一」），之後沒有寫入路徑 ——
 * 不是 key 的值一律當沒填，退回課程（那次搬遷就是把班級的年級聯集進課程）
 */
export function classGradeLevels(own: unknown, course: string[] | undefined): string[] {
  const keys = ownClassGradeLevels(own);
  return keys.length ? keys : (course ?? []);
}

/**
 * 班級**自己存的**年級（不退回課程）：空＝沿用課程。給班級表單分辨「沿用」與「自己存了跟課程一樣的」——
 * 只看合併值分不出來，編輯一次就會把沿用的班存成副本（#2122 之後的修正）
 */
export function ownClassGradeLevels(own: unknown): string[] {
  return (Array.isArray(own) ? own : []).filter((g): g is string =>
    (GRADE_KEYS as readonly string[]).includes(g as string),
  );
}
