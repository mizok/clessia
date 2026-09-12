/**
 * 從 `routes-catalog.ts` 生成 UI 地圖的骨架檔（issue #685 Phase 0）。
 *
 *   npx tsx tools/sitemap/generate-sitemap-skeletons.ts          # 生成 / 更新
 *   npx tsx tools/sitemap/generate-sitemap-skeletons.ts --check  # 只檢查，不寫檔
 *
 * **為什麼是 import 而不是 regex 掃原始碼**：`RoutesCatalog` 是一個會執行的類別，
 * 路由清單是 `register()` 的副作用。要知道它註冊了什麼，**問它本人最準** ——
 * 讀原始碼推論的話，任何一種我沒想到的寫法（條件註冊、迴圈、繼承）都會靜靜漏掉，
 * 而漏掉的樣子跟「本來就沒有」一模一樣。`user-type.ts` 與 `navigation-group.ts`
 * 都是無依賴的純 TS，所以 import 得動，不需要 Angular。
 *
 * **為什麼骨架檔可以重複生成而不會蓋掉人寫的內容**：只有 `<!-- generated:... -->`
 * 兩個標記之間那一段是這支腳本擁有的（路由、角色、選單位置這些「從程式碼來」的事實），
 * 其餘一律不動。Phase 1 會 fan out 給多席同時寫，**一次重跑洗掉別人半天的工作
 * 是這支腳本唯一真正危險的失敗模式**，所以預設就不具備那個能力。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RoutesCatalog,
  type RouteObj,
} from '../../apps/web/src/app/core/smart-enums/routes-catalog';
import { todayLocal } from '../../apps/web/src/app/shared/utils/session-time.util';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const OUT_ROOT = join(REPO_ROOT, 'kb', 'wiki', 'specs', 'sitemap');

const GEN_START = '<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->';
const GEN_END = '<!-- generated:route-facts end -->';

/**
 * 新建骨架的 `created:` / `updated:`。
 *
 * **本地日期，不是 `toISOString().slice(0, 10)`**（#702）—— 後者是 UTC，
 * 在 UTC+8 的凌晨 0–8 點會寫成前一天。`refresh()` 不碰日期，所以這只影響新建的頁面，
 * 但一個寫錯的 `created:` 沒有任何東西會叫。
 *
 * 用 `todayLocal` 而不是 date-fns 的 `format`：它是這個 repo 對「本地的今天」的
 * **具名單一定義**，而且那個檔零 import（跟 `RoutesCatalog` 一樣 import 得動）。
 * 再寫一種格式化法就是第二份定義。
 */
const TODAY = todayLocal();

interface RouteFacts {
  readonly route: RouteObj;
  readonly role: string;
  readonly slug: string;
  readonly relPath: string;
}

/** `/admin/courses/:courseId/classes/:classId` → `courses-courseId-classes-classId` */
function slugFor(route: RouteObj, role: string): string {
  const segments = route.absolutePath.split('/').filter(Boolean);
  // 角色前綴（admin / teacher / parent）不重複進檔名 —— 它已經是目錄名了
  const rest = segments[0] === role ? segments.slice(1) : segments;
  if (rest.length === 0) return 'index';
  return rest.map((s) => (s.startsWith(':') ? s.slice(1) : s)).join('-');
}

function roleFor(route: RouteObj): string {
  return route.role?.role ?? 'public';
}

function collect(): RouteFacts[] {
  return RoutesCatalog.values.map((route) => {
    const role = roleFor(route);
    const slug = slugFor(route, role);
    return { route, role, slug, relPath: join(role, `${slug}.md`) };
  });
}

/** 選單位置：群組標籤 › 頁面標籤，或明講它不在選單上 */
function menuLocation(route: RouteObj): string {
  if (!route.showInMenu) return '**選單不露出**（只能從別頁導過來或直接打網址）';
  const group = route.group?.label;
  return group ? `${group} › ${route.label}` : `（無群組）${route.label}`;
}

function generatedBlock(f: RouteFacts): string {
  const { route } = f;
  const lines = [
    GEN_START,
    '',
    `**路由**：\`${route.absolutePath}\``,
    `**角色**：${route.role ? `${route.role.label}（\`${f.role}\`）` : '公開（未登入可進）'}`,
    `**選單位置**：${menuLocation(route)}`,
    `**額外權限**：${route.permission ? `\`${route.permission}\`（\`permissionGuard\` + 選單隱藏）` : '無'}`,
    '',
    GEN_END,
  ];
  return lines.join('\n');
}

function skeleton(f: RouteFacts): string {
  const { route } = f;
  const title = `${route.label}`;
  return `---
title: ${title}（${route.absolutePath}）
summary: ${route.absolutePath} 的實際 UI 地圖：畫面區塊、互動元素、狀態與子頁面（對話框）。
category: spec
status: seedling
tags: [sitemap, ${f.role}]
created: ${TODAY}
updated: ${TODAY}
---

# ${title}

${generatedBlock(f)}

**進入方式**：<!-- TODO: 選單 / 從 <某頁> 的 <某按鈕> / 直接網址 -->

## 畫面區塊

<!-- TODO: 由上而下、由左而右，每個區塊一小節：它顯示什麼、資料從哪裡來 -->

## 互動元素

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後 |
| --- | --- | --- | --- |
| <!-- TODO --> | | | |

## 狀態

<!-- TODO: 空狀態 / 載入中 / 錯誤 / 無權限 -->

## 驗證紀錄

<!-- TODO: 照 kb/wiki/specs/sitemap/README.md 的兩向比對做完再填。
     未驗證的頁面 status 保持 seedling；驗完改成 developing。 -->

- **狀態**：未驗證
`;
}

/** 既有檔案只換生成區塊，其餘一字不動 */
function refresh(existing: string, f: RouteFacts): string {
  const start = existing.indexOf(GEN_START);
  const end = existing.indexOf(GEN_END);
  if (start === -1 || end === -1) {
    // 標記不見了（被手改掉或檔案是別的來源）—— 不猜，交給人處理
    throw new Error(
      `${f.relPath} 找不到 generated 標記。要嘛是手改時刪掉了，要嘛這個檔不是這支腳本生的。\n` +
        `不自動修復：這種情況下任何自動處置都可能蓋掉人寫的東西。`,
    );
  }
  return existing.slice(0, start) + generatedBlock(f) + existing.slice(end + GEN_END.length);
}

function main(): void {
  const check = process.argv.includes('--check');
  const facts = collect();

  // slug 撞名會讓兩條路由共用一個檔案，而症狀是「其中一頁的地圖莫名其妙被另一頁蓋掉」。
  // 與其設計一套保證不撞的命名，不如撞到就大聲喊 —— 現在沒撞，將來撞了也不會靜靜發生。
  const seen = new Map<string, string>();
  for (const f of facts) {
    const clash = seen.get(f.relPath);
    if (clash) {
      throw new Error(`slug 撞名：${f.route.absolutePath} 與 ${clash} 都會寫到 ${f.relPath}`);
    }
    seen.set(f.relPath, f.route.absolutePath);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const missing: string[] = [];

  for (const f of facts) {
    const abs = join(OUT_ROOT, f.relPath);
    const exists = existsSync(abs);

    if (check) {
      if (!exists) missing.push(f.relPath);
      continue;
    }

    const next = exists ? refresh(readFileSync(abs, 'utf8'), f) : skeleton(f);
    if (exists && next === readFileSync(abs, 'utf8')) {
      unchanged++;
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, next, 'utf8');
    exists ? updated++ : created++;
  }

  if (check) {
    console.log(`路由總數：${facts.length}`);
    if (missing.length > 0) {
      console.error(`✖ ${missing.length} 條路由沒有地圖檔：`);
      for (const m of missing) console.error(`  - ${m}`);
      process.exit(1);
    }
    console.log('✓ 每一條路由都有對應的地圖檔');
    return;
  }

  console.log(`路由總數：${facts.length}`);
  console.log(`新建 ${created}、更新生成區塊 ${updated}、未變動 ${unchanged}`);

  const byRole = new Map<string, number>();
  for (const f of facts) byRole.set(f.role, (byRole.get(f.role) ?? 0) + 1);
  console.log('依角色：' + [...byRole].map(([r, n]) => `${r} ${n}`).join('、'));
}

main();
