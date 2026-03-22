-- Rename soap_note to encounter_note (it's not a SOAP note)
ALTER TABLE visits RENAME COLUMN soap_note TO encounter_note;
