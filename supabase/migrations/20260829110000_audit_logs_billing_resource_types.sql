-- ============================================================
-- audit_logs.resource_type 加入 billing_period / fee_template
--
-- **為什麼是獨立一支、而且時間戳排在最後**
--
-- 這個 constraint 的慣例是 DROP + ADD **完整清單**，所以「最後執行的那一支說了算」。
-- P1 兩條軌並行時踩到一個不直覺的地方：**先合進 main 的不一定先執行。**
--
--   20260829093241  計費地基（A 軌，後合）
--   20260829100000  聯絡簿與教務日誌（B 軌，先合）  ← 時間戳較晚，最後執行
--
-- A 軌原本把清單寫在 093241 裡，但 B 軌的 100000 之後才跑、而且它的清單是照當時的
-- main 寫的（沒有 billing_period / fee_template）—— 結果就是 A 軌加的兩個值被
-- 靜靜地清掉。合併時看不出來，要等到有人記一筆金流的 audit log 才會炸。
--
-- 所以清單搬到這支：時間戳晚於兩條軌，內容是**兩邊的聯集**。
--
-- 下次再有多軌並行時，判斷依據是**時間戳順序**，不是合併順序。
-- ============================================================
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (
    resource_type IN (
      'class','course','campus','staff','session','student','parent',
      'enrollment','attendance','leave','academy_exam','school_exam','school',
      'contact_book_entry','class_log',
      'billing_period','fee_template'
    )
  );
