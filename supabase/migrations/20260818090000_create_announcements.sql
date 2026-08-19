-- ============================================================
-- announcements：站內公告（管理員發布 → 老師收件匣）
--
-- audience 的 enum 先寫入 all_parents，但這一版只實作 all_teachers。
-- 理由：enum 加值容易、改欄位貴；家長端接上時不必動 schema。
-- ============================================================
CREATE TYPE public.announcement_audience AS ENUM ('all_teachers', 'all_parents');

CREATE TABLE public.announcements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- null = 全分校。分校主任只發給自己校區的老師是現在就存在的情境
  campus_id    uuid REFERENCES public.campuses(id) ON DELETE CASCADE,
  audience     public.announcement_audience NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL,
  -- 發布即生效，這一版沒有草稿。要草稿的話再 ALTER 成 nullable
  published_at timestamptz NOT NULL DEFAULT now(),
  created_by   text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX announcements_org_id_idx ON public.announcements (org_id);
CREATE INDEX announcements_campus_id_idx ON public.announcements (campus_id);
-- 收件匣一律「某個 audience、依發布時間倒序」
CREATE INDEX announcements_audience_published_idx
  ON public.announcements (org_id, audience, published_at DESC);

CREATE TRIGGER announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- announcement_reads：已讀狀態
--
-- 沒有它就無法顯示「3 則未讀」，公告會變成一個沒人想點的選單項目。
-- 複合主鍵天然保證同一人同一則只有一筆，不需要額外的 unique index。
-- ============================================================
CREATE TABLE public.announcement_reads (
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX announcement_reads_user_id_idx ON public.announcement_reads (user_id);

-- ============================================================
-- 業務表一律啟用 RLS 但不建 policy：service role 會繞過它，
-- 授權真正發生在 Hono middleware（c1）。這是 fail-closed 後盾 ——
-- 將來若真的接上 anon client，會被全拒而不是全放。
-- ============================================================
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
