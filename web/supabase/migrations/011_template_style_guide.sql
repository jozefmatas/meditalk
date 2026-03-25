-- Add style_guide column to templates table.
-- Holds AI-generated writing style description (bullet-point list) for prompt injection.
ALTER TABLE templates ADD COLUMN style_guide text;
