-- Remove the patient_letter column from visits.
-- The patient letter feature was never exposed in the UI and wasted
-- output tokens on every generation. All letter-related code has been
-- removed from the application.
ALTER TABLE visits DROP COLUMN IF EXISTS patient_letter;
