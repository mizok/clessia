/**
 * A29. 每個有模板的目錄都要被 `tailwind.css` 的 `@source` 涵蓋。
 *
 * `tailwind.css` 是 `source(none)`：**只有 `@source` 列出來的路徑會被掃**。新目錄忘了加，
 * 它的 class 就不會被產生 —— 但如果別的頁剛好用過同一個 class，畫面照樣正常，所以本機看不出來，
 * 要等哪天那個 class 從別頁消失才壞。2026-10-23 一天踩三次（家長通知頁、骨架元件、操作紀錄入口鈕，計畫席）。
 *
 * 「有模板」＝ `.html`，或 `.ts`（不含 `.spec.ts`）裡有 inline `template:`。路徑都是 repo 相對。
 *
 * @param {string[]} files 候選檔（repo 相對；`.html` 與 `.ts`）
 * @param {(file: string) => string} read 讀檔
 * @param {(path: string) => boolean} covers 這個路徑有沒有被某一條 `@source` 涵蓋
 * @returns {string[]} 沒被涵蓋的目錄（去重、排序）
 */
export function uncoveredTemplateDirs(files, read, covers) {
  const dirs = new Set();
  for (const file of files) {
    if (file.endsWith('.spec.ts')) continue;
    const isTemplate =
      file.endsWith('.html') || (file.endsWith('.ts') && /\btemplate\s*:/.test(read(file)));
    if (isTemplate && !covers(file)) dirs.add(file.slice(0, file.lastIndexOf('/')));
  }
  return [...dirs].sort();
}
