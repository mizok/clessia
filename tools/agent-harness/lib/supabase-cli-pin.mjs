/**
 * Supabase CLI 版本：CI（verify）跟正式 DB（migrate）必須同一個、而且是釘死的數字。
 *
 * 2026-11-02：verify 用 `version: latest`，新版 CLI 拒絕 config.toml 的 `[inbucket]`，
 * api-contract 紅、deploy 被 skip；migrate 卻釘在 2.119.0 —— 兩邊跑的是不同的 CLI。
 *
 * 規則：每個 `supabase/setup-cli` 的 `version` 都寫 `${{ env.SUPABASE_CLI_VERSION }}`，
 * 而每支用到它的 workflow 的 `SUPABASE_CLI_VERSION` 都是同一個 x.y.z。
 *
 * @param {{ name: string, text: string }[]} workflows
 * @returns {string[]} 問題描述；空陣列＝沒事
 */
export function cliPinProblems(workflows) {
  const problems = [];
  const versions = new Map();
  for (const { name, text } of workflows) {
    const uses = [...text.matchAll(/uses:\s*supabase\/setup-cli@[^\n]*\n((?:[ \t]+[^\n]*\n)*)/g)];
    if (uses.length === 0) continue;
    for (const [, block] of uses) {
      const version = block.match(/^\s*version:\s*(.+?)\s*$/m)?.[1];
      if (version !== '${{ env.SUPABASE_CLI_VERSION }}') {
        problems.push(
          `${name}：supabase/setup-cli 的 version 是 \`${version ?? '（沒寫＝latest）'}\`，要寫 \`\${{ env.SUPABASE_CLI_VERSION }}\``,
        );
      }
    }
    const pinned = text.match(/^\s*SUPABASE_CLI_VERSION:\s*(\S+)\s*$/m)?.[1];
    if (!pinned || !/^\d+\.\d+\.\d+$/.test(pinned)) {
      problems.push(`${name}：用了 supabase/setup-cli 但 SUPABASE_CLI_VERSION 不是釘死的 x.y.z（${pinned ?? '沒寫'}）`);
    } else {
      versions.set(name, pinned);
    }
  }
  if (new Set(versions.values()).size > 1) {
    problems.push(
      `各 workflow 的 SUPABASE_CLI_VERSION 不一樣（${[...versions].map(([n, v]) => `${n}=${v}`).join('、')}）—— CI 跟 migrate 要跑同一個 CLI`,
    );
  }
  return problems;
}
