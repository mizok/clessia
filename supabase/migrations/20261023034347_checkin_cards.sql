-- 可作廢的到班卡代碼（#1100 #42，使用者 10-23 裁定；設計：#1100 計畫席批准 10-23）
--
-- 原本卡上的 QR 就是學生 id（students.id）—— 永遠作廢不了：拍照、遺失的卡一直有效。
-- 改成一張卡一個隨機代碼，補發＝作廢舊的＋開新的。
--
-- 代碼：`CK1-` 前綴＋ 16 位 Crockford base32（80 bit 隨機，api 用 crypto.getRandomValues 產生）。
-- 前綴讓機台分得出新卡與舊卡（舊卡是 UUID）；`1` 留給以後換格式。卡面每 4 碼一組印出來方便手打，
-- DB 存不分組的正規形式。
--
-- **純新表，沒有 backfill**：有效卡在第一次印卡時才建立。api 還沒讀這張表，套完才部署、部署完才套都安全
-- （程式 PR 會讀它，那張要等這支套上正式 DB 才合）。

CREATE TABLE public.checkin_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  code          text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  issued_by     text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  revoked_by    text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  revoke_reason text,
  CONSTRAINT checkin_cards_code_format CHECK (code ~ '^CK1-[0-9A-HJKMNP-TV-Z]{16}$'),
  -- 作廢的資訊只在作廢後才有
  CONSTRAINT checkin_cards_revoke_fields CHECK (
    revoked_at IS NOT NULL OR (revoked_by IS NULL AND revoke_reason IS NULL)
  )
);

-- 機台用代碼查卡；代碼全域唯一（80 bit 隨機，撞到就讓 insert 失敗重抽）
CREATE UNIQUE INDEX checkin_cards_code_key ON public.checkin_cards (code);

-- 一位學生同時只有一張有效卡：補發是「作廢舊的＋開新的」，DB 擋住兩張同時有效（並行補發也一樣）
CREATE UNIQUE INDEX checkin_cards_one_active ON public.checkin_cards (student_id)
  WHERE revoked_at IS NULL;

CREATE INDEX checkin_cards_org_student_idx ON public.checkin_cards (org_id, student_id);

COMMENT ON TABLE public.checkin_cards IS
  '到班卡（#1100 #42）：一張卡一個可作廢的代碼；一位學生同時只有一張有效卡';

-- 照慣例：啟用 RLS、不加 policy（fail-closed 後盾；api 走 service role）
ALTER TABLE public.checkin_cards ENABLE ROW LEVEL SECURITY;
