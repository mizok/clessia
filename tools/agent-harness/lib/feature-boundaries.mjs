/**
 * 守 c5：`features/<a>/**` 不得 import `features/<b>/**`。
 *
 * ## 為什麼是專用函式而不是一條 pre-guard 規則
 *
 * `pre-guard.rules.json` 的引擎做的是「路徑 pattern × 內容 pattern」比對，
 * 而 c5 需要的是**把相對 import 解析成絕對路徑，再比較兩端的 feature 名** ——
 * 那是引擎表達不了的。A15 / A17 已經是同一類的先例。
 *
 * ## 偵測形狀
 *
 * 跨 feature 有**兩種寫法**，都要認：
 *
 * 1. **相對路徑**（`../../teacher/...`）—— 目前全庫實際用的只有這種
 * 2. **別名**（`@features/teacher/...` 或 `@app/features/teacher/...`）——
 *    目前沒有人這樣寫，**但 `apps/web/tsconfig.json` 確實定義了 `@features/*` 與 `@app/*`**
 *
 * 第 2 種是我第一版漏掉的：我掃了實際 import 用法、看到零次 `@features/`，
 * 就下了「沒有這個別名」的結論。**「沒有人用」不等於「不能用」** ——
 * 別名擺在那裡，任何人明天就能寫出一個這道 gate 看不見的跨 feature import。
 * 是 self-test 去讀 tsconfig 才抓到這個錯誤前提。
 *
 * ## 能力邊界（**綠燈不等於 feature 之間沒有耦合**）
 *
 * 這支只看得到**路徑層面的直接 import**。看不到的：
 *
 * - **經由 `core/` 的間接耦合** —— 兩個 feature 各自 import 同一支 service，
 *   而那支 service 為了配合其中一個 feature 長出特例。那是 c5 真正想防的東西之一，
 *   而它在路徑上完全看不出來。
 * - **經由 `shared/` 元件的隱性依賴**（同上）。
 * - 動態 import 與字串拼出來的路徑。
 *
 * c5 是 Semantic 條款；這支只機器化「可判定的那一半」，另一半仍然靠 review。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** 從絕對路徑取出它屬於哪個 feature；不在 features/ 底下回 null */
function featureOf(absPath, featuresRoot) {
  const rel = relative(featuresRoot, absPath);
  if (rel.startsWith('..') || rel === '') return null;
  return rel.split('/')[0];
}

function collectTs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectTs(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * @param {string} featuresRoot `apps/web/src/app/features` 的絕對路徑
 * @param {string} repoRoot 用來把訊息裡的路徑縮成 repo 相對
 * @param {Record<string, string>} aliases 別名前綴 → 絕對目錄，例如
 *   `{ '@features/': …/features, '@app/': …/app }`。傳空物件就只檢查相對路徑。
 * @returns {Array<{file: string, line: number, from: string, to: string, spec: string}>}
 */
export function crossFeatureImports(featuresRoot, repoRoot, aliases = {}) {
  const found = [];

  for (const file of collectTs(featuresRoot)) {
    const source = readFileSync(file, 'utf8');
    const from = featureOf(file, featuresRoot);
    if (!from) continue;

    for (const m of source.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      let target = null;

      if (spec.startsWith('../')) {
        // 只有往上走的相對路徑有可能離開自己的 feature
        target = resolve(dirname(file), spec);
      } else {
        const hit = Object.entries(aliases).find(([prefix]) => spec.startsWith(prefix));
        if (!hit) continue;
        target = resolve(hit[1], spec.slice(hit[0].length));
      }
      const to = featureOf(target, featuresRoot);
      if (!to || to === from) continue;

      found.push({
        file: file.slice(repoRoot.length + 1),
        line: source.slice(0, m.index).split('\n').length,
        from,
        to,
        spec,
      });
    }
  }

  return found.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`));
}
