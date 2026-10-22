import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 守衛 spec 掃 `apps/web/src/app` 原始檔用（skeleton、skeleton-shimmer、chapter-sticky、fit-popover…）。
 *
 * **整棵樹只走一次、內容一起讀進來快取**（不穩定測試盤點 C）：原本每支 spec 在某一條 `it` 裡自己
 * `readdirSync` 走整棵 app/ 再逐檔 `readFileSync`，IO 全算進那一條的 5s 逾時，高負載的全套測試下
 * 偶發紅。改成在 spec 的模組層呼叫（收集測試的階段，不在任何一條測試的時間裡），同一個模組內共用快取。
 * 不要用加大 timeout 處理這類守衛。
 */
export const APP_DIR = resolve(process.cwd(), 'apps/web/src/app');

export interface SourceFile {
  /** 絕對路徑 */
  readonly path: string;
  readonly text: string;
}

let cache: readonly SourceFile[] | null = null;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** `apps/web/src/app` 底下符合條件的檔案（路徑＋內容） */
export function appSources(match: (path: string) => boolean): readonly SourceFile[] {
  cache ??= walk(APP_DIR).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  return cache.filter((f) => match(f.path));
}
