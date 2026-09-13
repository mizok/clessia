-- ============================================================================
-- seed 哨兵 —— 「`db:reset` 真的把資料造出來了」的憑證（#841）
--
-- **不是 seed，不進 `config.toml` 的 `sql_paths`。** 它只讀不寫，
-- 由 CI 在 `supabase db reset` 之後跑一次：`psql "$DATABASE_URL" -f supabase/seed-sentinels.sql`
--
-- ## 為什麼需要它
--
-- #838：`seed.sql` 的一段依賴另一支要手動套的檔案，而 `db:reset` 被 deny 擋著 ——
-- **長期沒有人跑得動，所以沒有人發現它壞了**，直到第一次真的跑就整批 rollback、
-- 本機變成空庫。期間那支 seed 被改過好幾次，每一次都只在「作者自己那台已經
-- 手動套過補充資料的機器」上驗過。
--
-- ## 為什麼查「資料在不在」而不是「有沒有報錯」
--
-- **`db:reset` 不報錯有兩種可能**：seed 真的跑了，或者某一支 seed 因為某種原因
-- 被跳過**而剛好也沒有東西去 RAISE**。#838 的驗收就是這樣定的：
-- 「沒有炸」證不出「資料在」。
--
-- ⚠️ **`pg_class.oid` 不是憑證**（2026-09-13 實測）：兩次 reset 的 `user_roles` oid
-- 都是 18454，而 schema 百分之百重建過 —— 兩次都從同一個空 schema 用同一份
-- migration 序列重建，**oid 計數器走同一條路，所以相同幾乎是常態而不是例外**。
--
-- ## 這裡的數字變了怎麼辦
--
-- **不要直接改成新的數字。** 先回答「為什麼變」：
-- 是 seed 刻意加了東西（那就改這裡，並在 commit 訊息寫清楚），
-- 還是某一段沒跑到（那是 #838 的形狀，要修的是 seed 不是這裡）。
-- ============================================================================
DO $$
DECLARE
  v_admin_count   INT;
  v_missing       TEXT := '';
BEGIN
  -- ── 哨兵 1：`seed-demo.sql` 真的被套了 ────────────────────────────────────
  --
  -- 張宇軒是 `seed-demo.sql` 造的（`seed.sql` 裡只有 SELECT 與 guard，零 INSERT）。
  -- **這一條就是 #838 的直接回歸測試**：它在的話，`sql_paths` 的第二支確實跑了。
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE name = '張宇軒') THEN
    v_missing := v_missing || E'\n  - students 裡沒有「張宇軒」 —— seed-demo.sql 沒有被套用'
      || E'（查 config.toml 的 sql_paths 是不是只剩 seed.sql）';
  END IF;

  -- 文山旗艦校同樣只在 seed-demo.sql 裡建立，而且是**另一個插入點**
  -- （11 個 `示範分校NN` 是迴圈造的，它不是）—— 兩條一起才涵蓋兩個插入點。
  IF NOT EXISTS (SELECT 1 FROM public.campuses WHERE name = '文山旗艦校') THEN
    v_missing := v_missing || E'\n  - campuses 裡沒有「文山旗艦校」 —— seed-demo.sql 的第二個插入點沒跑到';
  END IF;

  -- ── 哨兵 2：admin 角色的列數 ──────────────────────────────────────────────
  --
  -- **13，不是 15。** 算法（2026-09-13 從兩支 seed 逐項算出來，不是量出來的）：
  --
  --   1  `demo_admin`（admin@demo）           seed.sql:92
  --  11  迴圈 `FOR staff_index IN 1..11`       seed.sql:239
  --   1  寫死 UUID 的「老師兼行政」（#247）    seed.sql:354
  --  ──
  --  13
  --
  -- `seed-demo.sql:619` 給的 `["view_reports"]` 是**改上面第 3 列**
  -- （`ON CONFLICT DO UPDATE`），**不是新增第 14 個** —— `seed.sql:1588` 的註解
  -- 自己寫了這件事：「同一支 seed 裡兩個區塊寫同一列，後面那個贏」。
  --
  -- ⚠️ issue #841 原本寫「15 列」，那是 **#838 修好之前**的環境量的 ——
  -- 那個環境是「seed.sql ＋ 某人手動套過的東西 ＋ QA 殘留」，**不可重現**。
  -- 那正是 #838 要消滅的東西，所以基線用算出來的 13。
  SELECT count(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin';
  IF v_admin_count <> 13 THEN
    v_missing := v_missing || E'\n  - user_roles 的 admin 有 ' || v_admin_count
      || ' 列，期望 13（算法見本檔註解；多出來的通常是手動建立的殘留，少的話是某段 seed 沒跑）';
  END IF;

  -- ── 哨兵 3：`admin10` 是空權限 ────────────────────────────────────────────
  --
  -- #759 的權限矩陣段把 `[]` 這個展示狀態「還給 `admin10`」，理由寫在 seed.sql:1586：
  -- 原本掛在 teacher0001 上的 `[]` 被「展示狀態補齊」段覆蓋成 `["view_reports"]` 了。
  --
  -- **這一條同時守住一個順序關係**：#685（現在在 seed-demo.sql）與 #759（在 seed.sql）
  -- 寫的是不同列，所以誰先跑都一樣 —— 但那是查證出來的，不是天生保證的。
  -- 哪天有人讓它們寫到同一列，這條會紅。
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
      JOIN public.ba_user u ON u.id = ur.user_id
     WHERE u.email = 'admin10@demo.clessia.app'
       AND ur.role = 'admin'
       AND ur.permissions = '[]'::jsonb
  ) THEN
    v_missing := v_missing
      || E'\n  - admin10 不是空權限 —— 權限矩陣少了「有 admin 角色但零細部權限」那一格'
      || E'（見 seed.sql 的 #759 段）';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION E'seed 哨兵不通過：%\n\n這代表 `db:reset` 造出來的資料跟預期不符。\n「沒有報錯」證不出「資料在」—— 這支檔案存在的理由就是那件事（#838 / #841）。', v_missing;
  END IF;

  RAISE NOTICE 'seed 哨兵全數通過：seed-demo 已套用、admin 13 列、admin10 空權限';
END $$;
