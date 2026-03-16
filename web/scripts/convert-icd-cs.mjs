/**
 * One-time script: Download Czech ICD-10 (MKN-10) open data CSV
 * and convert to our internal format.
 *
 * Source: UZIS Czech Republic (open data)
 * Output: public/icd-10/ICD-10-CS.csv
 *
 * Usage: node scripts/convert-icd-cs.mjs
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "..", "public", "icd-10", "ICD-10-CS.csv");
const SOURCE_URL =
  "https://data.mzcr.cz/data/distribuce/463/Otevrena-data-OIS-12-03-ciselnik-mkn-10-cz.csv";

async function main() {
  console.log("Fetching Czech ICD-10 CSV from UZIS...");
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  const lines = text.split("\n");
  // Header: ciselnik,ciselnik_kod,ciselnik_nazev,kod_IRI,kod,kod_tecka,nazev,...
  const header = lines[0];
  const cols = header.split(",").map((c) => c.replace(/^"|"$/g, ""));
  const iKodTecka = cols.indexOf("kod_tecka");
  const iNazev = cols.indexOf("nazev");

  if (iKodTecka === -1 || iNazev === -1) {
    throw new Error(
      `Could not find required columns. Found: ${cols.join(", ")}`,
    );
  }

  const outputLines = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV carefully (fields may contain commas inside quotes)
    const fields = parseCSVLine(line);
    const code = fields[iKodTecka];
    const description = fields[iNazev];

    if (!code || !description) {
      skipped++;
      continue;
    }

    // Output format matches English CSV: "description",CODE-truncated_description
    const truncated = description.substring(0, 40);
    const escaped = description.includes(",") ? `"${description}"` : description;
    outputLines.push(`${escaped},${code}-${truncated}`);
  }

  writeFileSync(OUTPUT, outputLines.join("\n") + "\n", "utf-8");
  console.log(
    `Written ${outputLines.length} entries to ${OUTPUT} (skipped ${skipped})`,
  );
}

/** Simple CSV line parser that handles quoted fields with commas */
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
