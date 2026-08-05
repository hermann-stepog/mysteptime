ALTER TABLE public.drake_worker_qualifications ADD COLUMN IF NOT EXISTS issue_date DATE;
NOTIFY pgrst, 'reload schema';