-- 新增 enum
CREATE TYPE public.staff_status AS ENUM ('active', 'inactive', 'archived');

-- 新增 status 欄位，從 is_active 遷移
ALTER TABLE public.staff ADD COLUMN status public.staff_status NOT NULL DEFAULT 'active';

UPDATE public.staff
SET status = CASE
  WHEN is_active = true THEN 'active'::public.staff_status
  ELSE 'archived'::public.staff_status
END;

-- 移除舊欄位
ALTER TABLE public.staff DROP COLUMN is_active;
