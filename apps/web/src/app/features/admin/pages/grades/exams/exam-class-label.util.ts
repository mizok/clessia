export interface ExamClassRef {
  id: string;
  name: string;
  /** 有它才連得到班級頁（#1314 G1b）；舊回應沒有 */
  courseId?: string;
}

/** 列上看得到的一個班名，帶得到班級頁就是連結（#1314 G1b） */
export interface ExamClassLink {
  readonly id: string;
  readonly name: string;
  readonly link: readonly string[] | null;
}

/** 超過幾個班就收成「等 N 個班」—— 列表一列放不下十個班名 */
const MAX_NAMES = 3;

/**
 * 考試列表「參加班級」的呈現（#1314 G1）。
 *
 * - `label`：列上看的字，≤ 3 個班全列、超過寫前 3 個＋「等 N 個班」；沒有班（`classes` 空）回 null。
 * - `title`：完整清單，給 `title` 屬性；沒被收起來就跟 label 一樣。
 */
export function examClassLabel(
  classes: readonly ExamClassRef[],
): { label: string; title: string } | null {
  if (classes.length === 0) return null;
  const title = classes.map((c) => c.name).join('、');
  if (classes.length <= MAX_NAMES) return { label: title, title };
  const head = classes
    .slice(0, MAX_NAMES)
    .map((c) => c.name)
    .join('、');
  return { label: `${head} 等 ${classes.length} 個班`, title };
}

interface ScopeSource {
  scopeNote: string | null;
  classCount: number;
  classes?: readonly ExamClassRef[];
}

/**
 * academy 列的「範圍」欄（#1314 G1）。
 *
 * - 有 `scopeNote`（人寫的範圍說明）：維持原樣當主字，班名另給 `classLabel` 補在小字行。
 * - 沒有 `scopeNote`：主字就是班名；連班都沒有才退回「N 個班」。
 */
export function academyScope(exam: ScopeSource): {
  scope: string;
  classLabel: string | null;
  classTitle: string | null;
  classLinks: readonly ExamClassLink[];
  classMore: string;
} {
  const note = exam.scopeNote?.trim();
  const classes = exam.classes ?? [];
  const named = examClassLabel(classes);
  return {
    scope: note || named?.label || `${exam.classCount} 個班`,
    classLabel: note && named ? named.label : null,
    classTitle: named?.title ?? null,
    // 班名那段拆成一個個連結（稿 `.ex__where a` 連班級頁，#1314 G1b）；收起來的部分照 `examClassLabel`
    classLinks: classes.slice(0, MAX_NAMES).map((c) => ({
      id: c.id,
      name: c.name,
      link: c.courseId ? ['/admin/courses', c.courseId, 'classes', c.id] : null,
    })),
    classMore: classes.length > MAX_NAMES ? ` 等 ${classes.length} 個班` : '',
  };
}
