---
title: 停用 vs 封存 —— 不是同一個動作的兩種叫法，裁定不統一
summary: M4 詞彙統一（#425）查證結論——停用（可逆）與封存（不可逆）是兩個不同的動作，用字差異忠實反映各自的狀態模型，不該合併成一個字。計畫席裁定：兩個字都留著。
category: architecture
status: active
updated: 2026-09-06
---

# 停用 vs 封存

M4 詞彙統一（#425）把「停用」（學生）與「封存」（家長、員工）列成疑似不一致。
查證後**這不是同一個動作的兩種叫法，是兩個不同的動作**——差異在狀態模型，不在用字。
用字是對的，忠實反映了各自能做什麼。**計畫席裁定：不統一，兩個字都留著。**

## 家長 / 員工：三態，兩個動作可逆性不同

`apps/web/src/app/features/admin/pages/parents/parents.page.ts:169-190`：

```ts
if (parent.status === 'active') {
  items.push({ label: '停用帳號', ... command: () => this.confirmDeactivate(parent) });
} else if (parent.status === 'inactive') {
  items.push({ label: '啟用帳號', ... command: () => this.confirmActivate(parent) });
}
if (parent.status !== 'archived') {
  items.push({ label: '封存帳號', ... command: () => this.confirmArchive(parent) });
}
```

三態：`active` / `inactive` / `archived`。**兩個動作、兩個判斷式，不是同一個開關的兩種說法**：

| 動作 | 目標狀態   | 判斷式                  | 可逆性                         | confirm 文案                                        |
| ---- | ---------- | ----------------------- | ------------------------------ | --------------------------------------------------- |
| 停用 | `inactive` | `status === 'active'`   | **可逆**——有對應的「啟用帳號」 | `parents.page.ts:411`「停用後該家長將無法登入系統」 |
| 封存 | `archived` | `status !== 'archived'` | **不可逆**                     | `parents.page.ts:437`「封存後無法透過系統自動復原」 |

員工（`apps/web/src/app/features/admin/pages/staff/staff.page.ts:199-214`）是**同一套三態模型**，`confirmArchive` 的文案更直白：「確定要封存⋯嗎？封存後無法取消，帳號將永久停用且無法登入」（`staff.page.ts:426`）。

## 學生：兩態，只有一個動作

`apps/api/src/routes/students.ts:639`：`is_active` 是**布林**，不是三態 enum。對應地
`students.page.ts` 只有「停用」這一個動作（`students.page.ts:149,283-286`），沒有「封存」
——因為學生的資料模型裡根本沒有 `archived` 這個狀態可以封存。confirm 文案是「停用後該學生
將不會出現在預設篩選結果中」（可逆，沒有「無法復原」的語言）。

## 為什麼不能統一

把「停用」與「封存」合併成一個字，會讓**可逆**（隨時能點「啟用帳號」復原）與**不可逆**
（confirm 文案明講「無法自動復原」）在畫面上長得一樣——這正是這一輪（#426 骨架化、
inline-notice 色差）一直在追的同一種形狀：**兩個語意不同的狀態被壓成同一種視覺/用字**，
使用者少了「這個動作能不能反悔」的訊號。

**判準**：這個實體的狀態模型有幾態，決定它能有幾個動作、該用幾個字。學生兩態一個字，
家長／員工三態兩個字——字數跟狀態數對得上，不是隨機分裂。

## 相關但容易誤讀的既有註解

`parents.page.ts` 的 `statusTone()` 有一句「停用與封存都是『不在等了』，同一個 tone」——
**這句話只在講顯示色調**（`inactive` 狀態的圖示/文字顏色），不是在說兩個動作是同一件事。
已經在程式碼裡把這句話講得更清楚，指回本文件。
