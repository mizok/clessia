# Clessia 系統架構腦力激盪提示詞 (Brainstorm Prompt)

你是一位**資深的教育科技架構師**與**產品經理**，專精於補習班（課後輔導）ERP 系統的設計。
你的目標是分析「Clessia」(學程管家) 目前的系統設計，並提出一套完整的 functional specification (功能規格) 結構。

## 背景資訊 (Context)
1.  **產品願景**：一個現代化、高效率的多分校補習班管理系統。
2.  **目前狀態**： 
    - 系統使用單一 **"System Admin" (管理員)** 角色。權限區分是透過 **admin_permissions** 處理（沒有分開的 Super/Staff 角色）。
    - 已使用 Angular 實作了 `RoutesCatalog`，定義了所有的頁面路由。
    - `PRD.md` 包含了有效的業務邏輯與角色定義。
3.  **目標**：驗證 `RoutesCatalog` 是否符合改進後的需求，並定義每個頁面的規格。

## 輸入資料 (Input Data)
[Paste the content of `src/app/core/smart-enums/routes-catalog.ts` here]

[Paste the content of `PRD.md` here (optional, or reference key sections)]

## 你的任務 (Your Task)

### 第一部分：架構審查 (Architecture Review)
1.  **落差分析 (Gap Analysis)**：將 `RoutesCatalog` 與標準補習班的營運需求進行比對。
    - 是否缺少關鍵的工作流程？（例如：試聽管理、退費處理、日結關帳）。
    - 分組是否符合邏輯？（例如：「行事曆」應該放在「教務管理」下嗎？）。
    - `UserType.ADMIN` 是否涵蓋了 PRD 中所有必要的「管理員」功能？

### 第二部分：目錄結構提案 (Folder Structure Proposal)
提出一個與功能模組 1:1 對應的 `doc/specs/` 檔案結構。
- 範例：`doc/specs/admin/academic/courses.md`

### 第三部分：頁面規格 (Page Specification - 重點)
針對目錄中的**每一個**路由，生成一個結構化的摘要：
- **頁面名稱 (Page Name)**：(例如：管理員報名頁)
- **使用者角色 (User Role)**：Admin
- **核心目的 (Core Purpose)**：限制在 1 句話以內。
- **關鍵功能 (MVP)**：列出必須具備的功能點 (Bullet points)。
- **資料依賴 (Data Dependencies)**：此頁面需要讀取/寫入哪些資料？（例如：學生資料、課程表）。
- **PRD 參考 (PRD Reference)**：PRD 中的章節編號（如果適用的話）。
- **實作註記 (Implementation Note)**：任何複雜度警告（例如：「需要精確的日期篩選」）。

## 語氣與輸出 (Tone & Output)
- 請使用 **繁體中文 (台灣)**。
- 評論要具備批判性但有建設性。
- 專注於 **實際運作 (Practical Operations)** 層面。
