import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * **使用者層級**的 skill —— 裝在使用者的 home，不進這個 repo 的版控。
 *
 * 這類 skill 是跨專案共用的通用工具，收進 repo 只會多一份會漂掉的副本。代價是
 * 換一台機器 clone 下來它就不在，而 AGENTS.md 把它寫得像專案工具 —— 真的踩過：
 * 有人照著指令表打 `/kb-wiki map` 然後撲空。
 *
 * 所以這裡**只警告不紅燈**：別人的機器裝不裝是他的事，但缺口要看得見。
 *
 * `probe` 是相對 home 的路徑，刻意指向 skill 真正會被叫到的那支腳本而不是目錄 ——
 * 目錄可能是斷掉的 symlink。
 */
export const USER_SKILLS = [
  {
    name: 'kb-wiki',
    probe: '.claude/skills/kb-wiki/scripts/map.ts',
    why: 'kb/ 的索引與 MOC 沒有生成器，`/kb-wiki lint` 與 `/kb-wiki map` 都叫不動，只能手補',
  },
];

/**
 * 這台機器上缺了哪些使用者層級 skill。
 *
 * `home` 與 `exists` 可注入純粹是為了測試 —— 兩個方向都要測得到（裝了不警告、
 * 沒裝要警告），不然「只警告不紅燈」這個性質沒有東西守。
 */
export function missingUserSkills(home = homedir(), exists = existsSync) {
  return USER_SKILLS.filter((skill) => !exists(join(home, skill.probe)));
}
