-- 操作紀錄（方案 A）：在 classes 表加 updated_by，記錄最後修改者
-- 使用 ba_user(id) 而非 profiles(id)，因為 Better Auth 的 user ID 是 text 存在 ba_user 表
ALTER TABLE public.classes
  ADD COLUMN updated_by text REFERENCES public.ba_user(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.classes.updated_by IS '最後修改此班級的使用者 ID（ba_user）';
