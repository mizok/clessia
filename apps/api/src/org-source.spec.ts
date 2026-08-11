import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 使用者所屬機構的唯一真相是 `ba_user.orgId`（Better Auth additionalField）。
 *
 * `profiles.org_id` 是 Supabase Auth 時代的遺留：原本由 `handle_new_user()` 觸發器自動建列，
 * 而該觸發器在 Better Auth 遷移（20260222000001）時被 DROP，之後沒有任何替代品。現在只有
 * `seed.sql` 會寫入 profiles —— 透過 app 建立的員工與家長在那張表裡根本沒有列。
 *
 * 曾經發生的後果：auth middleware 讀 `profiles.org_id`，於是**每個由 app 建立的使用者在每一個
 * 請求上都拿到 400 NO_ORG**，完全無法使用系統；staff 的角色篩選也會讓這些人整批消失。
 *
 * 這支測試守的就是「別再加回來」。
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)));

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectTsFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('org 來源', () => {
  it('沒有任何程式碼從 profiles 讀取 org_id', () => {
    const offenders: string[] = [];

    for (const file of collectTsFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      // 只看 profiles 查詢後面緊接著取 org_id 的形狀，避免誤判 display_name 之類的合法用法
      if (/from\(\s*'profiles'\s*\)[\s\S]{0,120}?org_id/.test(source)) {
        offenders.push(file.replace(`${SRC}/`, ''));
      }
    }

    expect(offenders, 'org 的唯一真相是 ba_user.orgId，見本檔頂端說明').toEqual([]);
  });
});
