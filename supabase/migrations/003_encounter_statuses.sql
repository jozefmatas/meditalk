-- MediTalk: Encounter status migration
-- Old statuses: draft, completed, archived
-- New statuses: draft, recording, processing, review, closed, archived

-- Migrate existing "completed" rows to "closed"
UPDATE public.visits SET status = 'closed' WHERE status = 'completed';

-- Add a comment for documentation
COMMENT ON COLUMN public.visits.status IS 'Encounter status: draft, recording, processing, review, closed, archived';
