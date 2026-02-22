# 登入頁

**路徑**: `/login`
**角色**: 無需登入

## 核心目的

使用者輸入帳號密碼登入系統。

## MVP 功能

- 登入欄位：Email
- 密碼輸入與驗證
- 忘記密碼連結（⚠️ 尚未完整實作，見下方 Backlog）
- 錯誤訊息提示（帳號不存在、密碼錯誤）
- 登入成功後依角色導向對應首頁

## Backlog

### 手機號碼登入（延後至家長介面開發時）

- 沒有 email 的家長可使用手機號碼登入（格式：`09xxxxxxxx`）
- 實作方式：輸入手機號碼 → 後端查 `ba_user.phone` 反查帳號 → 用 email 登入
- 沒有 email 的帳號忘記密碼時，需聯絡管理者處理
- 需要新增自訂 Hono endpoint：`POST /api/auth/sign-in/phone`

### 忘記密碼完整實作（獨立 branch）

功能目前前端流程已完成，但 email 實際上不會送出。完整實作需要：

1. **Resend** 串接（寄信服務，免費方案 100 封/天，成長後升級 Pro $20/月）
2. **per-email 冷卻時間**（Cloudflare KV，同一 email 15 分鐘內只能發一封）
3. **Turnstile 伺服器驗證**（目前 token 有收但未驗證）
4. 以上三項需一起實作，不建議分批補

## 資料依賴

| 操作 | 資料表 |
|------|--------|
| 讀取 | `profiles`, `ba_user` |

## PRD 參考

- 7.1 公開頁面

## 相關頁面

- `/forgot-password` - 忘記密碼
- `/reset-password` - 重設密碼
