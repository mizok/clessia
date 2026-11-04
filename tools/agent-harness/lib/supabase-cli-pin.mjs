/**
 * Supabase CLI 版本：CI（verify）跟正式 DB（migrate）必須同一個、而且是釘死的數字。
 *
 * 2026-11-02：verify 用 `version: latest`，新版 CLI 拒絕 config.toml 的 `[inbucket]`，
 * api-contract 紅、deploy 被 skip；migrate 卻釘在 2.119.0 —— 兩邊跑的是不同的 CLI。
 *
 * 規則：每個 `supabase/setup-cli` 的 `version` 都寫 `${{ env.SUPABASE_CLI_VERSION }}`，
 * 而每支用到它的 workflow 的 `SUPABASE_CLI_VERSION` 都是同一個 x.y.z。
 *
 * **本機也算一處**（#2252）：root `package.json` 沒宣告 `supabase` 時，`npx supabase` 抓 npm 上最新的
 * （11-04 是 3.0.0，不認 `[local_smtp]`，本機 db reset 失敗）。所以給了 `packageJson` 就要求
 * `devDependencies.supabase` 是同一個 x.y.z（不帶 `^`／`~`）。
 *
 * @param {{ name: string, text: string }[]} workflows
 * @param {string} [packageJson] root package.json 的內容
 * @returns {string[]} 問題描述；空陣列＝沒事
 */
export function cliPinProblems(workflows, packageJson) {
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
  if (packageJson !== undefined) {
    const local = JSON.parse(packageJson)?.devDependencies?.supabase;
    if (!local || !/^\d+\.\d+\.\d+$/.test(local)) {
      problems.push(
        `package.json：devDependencies.supabase 不是釘死的 x.y.z（${local ?? '沒寫'}）—— 沒釘的話本機 npx supabase 會抓 npm 最新版`,
      );
    } else {
      versions.set('package.json', local);
    }
  }
  if (new Set(versions.values()).size > 1) {
    problems.push(
      `各 workflow 的 SUPABASE_CLI_VERSION 不一樣（${[...versions].map(([n, v]) => `${n}=${v}`).join('、')}）—— CI、migrate 與本機要跑同一個 CLI`,
    );
  }
  return problems;
}
