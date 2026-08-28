---
title: 供應商關係與它推導出的架構約束
summary: 賣一套系統、客戶自付基礎設施、收維護費。客戶必須隨時能帶著資料離開 —— 這條原則否決了多租戶，也否決了任何 vendor lock-in。
category: architecture
tags: [architecture, business-model, tenancy, vendor-lock-in]
status: active
updated: 2026-08-28
---

# 供應商關係與它推導出的架構約束

這一頁是憲法 [[architecture/constitution|c12]] 的理由。

## 商業模式

賣一套系統給補習班，**客戶自己付 Supabase 的錢**，另外付維護費。類似台灣銀行業的做法：
系統是供應商的產品，資料與基礎設施是客戶的資產。

## 核心原則：客戶隨時能離開

> 我必須要維持客戶能夠自己脫離架構並且自己 host 自己系統的權力。

這不是承諾，是**架構約束**。它推導出下面每一條。

## 推論一：不做多租戶

多個客戶的資料放在同一個 Postgres 實例，就無法乾淨取出——**離開的權利在資料混在一起的那一刻消失。**

這也跟商業模式自相矛盾：「客戶自己付 Supabase」的前提就是資料庫是他們的。
多租戶等於供應商扛所有補習班的資料，那收的就該是 SaaS 訂閱費，不是維護費。

技術上 Supabase 完全支援多租戶（它就是 Postgres）。**否決它的是商業模式與離開權，不是技術。**

### 如果將來真的要做多租戶

**必須走 RLS，不能走應用層過濾。** 本專案的租戶隔離目前完全靠上百處查詢每一處都記得
加 `.eq('org_id', orgId)`——一次疏忽就是甲補習班讀到乙補習班的學生，而且無症狀。

而這個 codebase 已經證明過四次，架構層的缺口可以在所有 gate 綠燈的情況下存活數月
（見 [[lessons/status-table-blind-spot]]、[[lessons/rls-backstop-drift]]）。
沒有理由相信 `org_id` 過濾會是例外。

好消息是第一步已經完成：所有業務表都開著 RLS，只差 policy。

## 推論二：不依賴雲端供應商的專屬服務

Workers KV / R2 / Durable Objects、Supabase Realtime / Edge Functions——用了任何一個，
客戶的自架環境就得先有那個東西。

**限制的是程式碼，不是部署目標。** 部署到 Cloudflare 完全可以；讓程式碼**只能**跑在
Cloudflare 就不行。

現況（2026-08 查證）：API 對 Workers 的依賴只有 `c.env.*`（環境變數）與一個 `Bindings` 型別，
沒有用任何 Workers 專屬服務。`export default app` 是標準 Hono，加一個 `@hono/node-server`
入口就能在任何機器上跑。**原則目前沒有被違反，但也還沒有機制保護它**（c12 的 gate 待接）。

## 推論三：沒有 kill switch

License key、遠端啟用檢查、任何「停止付費就停止運作」的機制，全部禁止。

這代表**維護費不能靠鎖住客戶來收**。他們隨時能走，所以收的是「有你在比較省事」。

> 我就是要維持這個健康的關係, 沒打算養套殺。

這是比較健康的關係，但要有心理準備：**你隨時能被離開，所以你得一直有用。**

## 推論四：第三方身分是客戶自己的帳號

登入走 LINE OAuth（見 [[architecture/line-oauth-login]]）。憑證是**每個部署自己申請的**
LINE Developers channel —— 不是共用一組、也不經過供應商。

這**不構成 lock-in**：客戶自架時申請自己的 channel 就好，跟申請 Supabase 專案是同一
性質的動作。代價是多一個上線步驟，已寫進 [[architecture/bootstrapping-a-deployment]]。

反過來說，這也是為什麼**不能**共用一組 LINE channel：那會讓客戶的登入依賴供應商的
帳號還活著，正好是這一頁在避免的東西。

## 這條原則的代價

| 代價                 | 說明                                         |
| -------------------- | -------------------------------------------- |
| 維護成本線性成長     | 3 個客戶 = 3 套 Supabase、3 個部署、3 次升級 |
| 部署必須可重複       | 第二個客戶就會暴露一次性手動部署的問題       |
| 沒有 SaaS 的規模效益 | 客戶數是 business 的天花板                   |

**大約第 3–5 個客戶時值得重新評估**——那時維護成本會變成瓶頸。但重新評估的對象是
「要不要改商業模式」，不是「要不要偷偷加 lock-in」。

## 待辦

- **gate A10** —— c12 可決定的部分：禁止 import 雲端專屬服務。目前 `constitution-enforcement.md`
  標記為「⚠️ 部分：可決定部分待接」
- ~~**乾淨開站的路徑**~~ —— 已由 `apps/api/src/scripts/bootstrap-org.ts` 解決
  （見 [[architecture/bootstrapping-a-deployment]]）
- ~~**破窗管道**~~ —— 已由 `apps/api/src/scripts/login-link.ts` 解決，而且**比原本規劃的
  永久 root 帳號更符合 c12**：它用 `DATABASE_URL` 換一次性 session，**客戶換掉 DB 密碼
  就能撤銷供應商的存取**。拿不掉的後門才是問題
