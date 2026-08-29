/**
 * 生成器寫完檔之後把格式權交還給 prettier。
 *
 * 為什麼需要這個：markdown 表格的欄寬對齊由 prettier 決定，而生成器輸出的是不對齊的原始表格。
 * 兩邊各寫各的，結果是每次 `harness:write` 都在 repo 裡留下一片排版雜訊 ——
 * `kb/wiki/roadmap.md` 是 54 行、`AGENTS.md` 是 20 行，實質改動可能只有 2 行。
 * gate 的 `normalize()` 兩種都吃所以不會紅，於是這件事一直沒人修，只是每次改都要手動補跑。
 *
 * **不要反過來讓生成器自己輸出對齊的表格** —— 那是在跟 prettier 比誰貼得準，
 * 而且 prettier 的欄寬規則會隨版本變，必輸。
 *
 * 跟 PostToolUse hook 一樣用 npx 呼叫（見 hooks/post-tool-use.mjs），但**失敗語意不同**：
 * hook 絕不能擋編輯所以吞掉例外，這裡是 `--write` 模式的收尾，格式化失敗只會讓下一次
 * `--check` 紅燈，所以印出警告讓人看得見，但仍不改變 exit code（重生成本身是成功的）。
 */
import { execFileSync } from 'node:child_process';

export function formatGenerated(paths, cwd) {
  try {
    execFileSync('npx', ['prettier', '--write', '--ignore-unknown', ...paths], {
      cwd,
      stdio: 'ignore',
      timeout: 60_000,
    });
  } catch {
    console.warn(`⚠ prettier 沒跑成功，${paths.join(' / ')} 可能沒對齊（下次 --check 會紅）`);
  }
}
