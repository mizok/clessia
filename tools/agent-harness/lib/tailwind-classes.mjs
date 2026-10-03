/**
 * 「這個 class 在 Tailwind 頁上有沒有樣式」—— 給解析樣式的 gate 用（#991 P1／T3）。
 *
 * SCSS 刪掉之後，頁面的樣式活在 template 的 class 字串裡；只讀 SCSS 的 gate 會把整頁當成
 * 「沒定義」（A20 實例：Tailwind 按鈕被判成「會吃 button reset 渲染成純文字」）。
 *
 * 判準用 Tailwind 自己的 design system（`candidatesToCss`）：拼錯的、不存在的 utility 回空，
 * 跟 build 的行為一致。**只對 `tailwind.css` 的 `@source` 目錄底下的檔有效** —— 其他目錄不會被掃，
 * 寫在那裡的 `w-full` 實際上沒有樣式（PrimeFlex 遺留的死 class 就是這種）。
 *
 * ⚠️ API 名稱帶 `__unstable__`。Tailwind 升版時它若改名，這裡會丟例外而不是靜靜放行。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import { sourcePaths } from './scss-ledger.mjs';

/**
 * @param {string} root repo 根目錄
 * @returns {Promise<{ dirs: string[], covers: (path: string) => boolean, generates: (cls: string) => boolean, colorOf: (cls: string) => string | null } | null>}
 */
export async function loadTailwind(root) {
  const twFile = join(root, 'apps/web/src/tailwind.css');
  let css;
  try {
    css = readFileSync(twFile, 'utf8');
  } catch {
    return null;
  }
  const ds = await __unstable__loadDesignSystem(css, { base: dirname(twFile) });
  const dirs = sourcePaths(css).map((p) => join('apps/web/src', p).replace(/\/$/, ''));
  const cache = new Map();
  return {
    dirs,
    covers: (path) => dirs.some((d) => path === d || path.startsWith(`${d}/`)),
    generates(cls) {
      if (!cache.has(cls)) cache.set(cls, !!ds.candidatesToCss([cls])[0]);
      return cache.get(cls);
    },
    /** `text-zinc-600` → `var(--zinc-600)`；`bg-[#ebe7e4]` → `#ebe7e4`；不是顏色（`text-md`）回 null */
    colorOf(cls) {
      const css = ds.candidatesToCss([cls])[0] ?? '';
      return css.match(/(?:^|[{;\s])(?:color|background-color)\s*:\s*([^;}]+)/)?.[1].trim() ?? null;
    },
  };
}
