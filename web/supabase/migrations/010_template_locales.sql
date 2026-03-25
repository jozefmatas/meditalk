-- Add locales column to templates table.
-- Default = all supported locales, so existing templates keep working unchanged.
ALTER TABLE templates ADD COLUMN locales text[] NOT NULL DEFAULT '{sk,en,cs}';
