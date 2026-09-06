-- ============================================================
-- 補課：課堂可以標記「補的是哪一堂停課」
-- （issue #499 / #544，使用者 2026-09-06 三項裁定；設計見
--  kb/wiki/architecture/session-makeup.md）
-- ============================================================
--
-- **這個連結對計費完全不必要。** 補課那堂是一堂正常的課、本來就會扣一堂；
-- 停掉的那堂照 issue #485 的修法本來就不扣。所以使用者裁的「補了才扣」在資料上
-- 自動成立，而這個 FK 的價值在**可解釋性**：家長看到帳單少一堂會問為什麼，
-- 行政看到補課那堂會問這是補什麼的。
--
-- 三段：欄位、唯一性、enum。三者可以放同一支 —— `ALTER TYPE ... ADD VALUE`
-- 在 transaction 裡是允許的，只是**新值不能在同一個 transaction 裡被使用**
-- （實測：`ERROR: unsafe use of new value "makeup"`）。這支只宣告不使用，所以安全。

-- ── ① 自我參照 FK ──────────────────────────────────────────────────────────
--
-- `ON DELETE SET NULL` 而不是 `CASCADE`：被補的那堂如果真的被刪掉，
-- **補課那堂仍然是一堂真的發生過、而且已經扣過堂數的課**，不該跟著消失。
-- 連結斷掉是看得見的退化（標記不見了），CASCADE 是靜默的資料損失。
ALTER TABLE public.sessions
  ADD COLUMN makeup_for_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sessions.makeup_for_session_id IS
  '這堂課補的是哪一堂停課（1:1）。NULL = 一般課堂。**這是現況不是歷史** —— 歷史在 schedule_changes 的 makeup 那筆，兩者不一致代表「發生過然後被改掉」，不是矛盾。任何「這堂補的是哪一堂」的查詢一律走這個欄位，不要用 schedule_changes 推導。';

-- ── ② 1:1 的唯一性 —— **部分索引，不是普通 UNIQUE** ─────────────────────────
--
-- 使用者裁定「一堂停課最多配一堂補課」。字面上是加 UNIQUE，但普通 UNIQUE 會跟
-- 另一條裁示打架：**「補課那堂又被停掉 → 允許，連結保留」**（設計文件決策 5.1）。
--
-- 普通 UNIQUE 之下，那堂**停掉的**補課會永久佔住它的目標 —— 原本那堂停課
-- 再也補不了第二次，除非有人手動清掉 FK。而 5.1 的整個用意就是
-- 「那是真實發生過的事，不要抹掉」。**兩條規則會互相取消。**
--
-- 部分索引把語意收窄成「一堂停課最多配一堂**有效的**補課」，
-- 正好對上設計文件裡「有幾堂補課 vs 有幾堂有效的補課」那個區別。
--
-- ⚠️ **述詞裡的 `status <> 'cancelled'` 讓「復課」變成一個新的失敗點**：
-- 把一堂停掉的補課復課，如果它的目標同時已經有另一堂有效補課，這個索引會拒絕。
-- 那是對的行為，但 `uncancel` 那條路徑要在 update 之前擋下來、回 conflict，
-- 不要讓它變成 500（設計文件決策 5.5）。
--
-- 可補清單的排除條件**必須跟這個述詞逐字一致**，否則清單會列出一個索引會拒絕
-- 的選項，或藏起一個其實補得成的 —— 同一條規則的兩個載體之間漂移。
CREATE UNIQUE INDEX sessions_makeup_for_unique
  ON public.sessions (makeup_for_session_id)
  WHERE makeup_for_session_id IS NOT NULL AND status <> 'cancelled';

-- 反向查詢（「這堂停課被誰補了」）與 FK 檢查都吃它。
-- 部分索引不能當這個用途（它排除了停掉的補課，而反向查詢要看得到全部）。
CREATE INDEX sessions_makeup_for_idx ON public.sessions (makeup_for_session_id);

-- ── ③ 異動紀錄的類型 ────────────────────────────────────────────────────────
--
-- 使用者裁定補課要出現在組織級異動紀錄。**`ADD VALUE` 不可逆**
-- （Postgres 不支援移除 enum 值，而已提交的 migration 不可改，憲法 c3）——
-- 使用者已知情並決定要。
--
-- ⚠️ 前端的 `CHANGE_TYPE_LABELS`（changes.component.ts）**要一起補 'makeup'**：
-- 漏了不會報錯 —— 篩選選項會**整個不存在**（它從那張表 Object.entries 產生），
-- 而表格因為 `?? value` 顯示原始 enum 值。列會出現、但篩不到、顯示成一個英文字。
ALTER TYPE public.schedule_change_type ADD VALUE 'makeup';
