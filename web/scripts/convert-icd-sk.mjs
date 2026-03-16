/**
 * One-time script: Download Slovak ICD-10 (MKCH-10) XLS from NCZI
 * and convert to our internal format.
 *
 * Source: NCZI Slovakia
 * Output: public/icd-10/ICD-10-SK.csv
 *
 * Usage: node scripts/convert-icd-sk.mjs
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "..", "public", "icd-10", "ICD-10-SK.csv");
const SOURCE_URL =
  "https://www.nczisk.sk/Documents/aktuality/Medzinarodna_klasifikacia_chorob_01012026.xls";

async function main() {
  console.log("Fetching Slovak ICD-10 XLS from NCZI...");
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();

  console.log("Parsing XLS...");
  const workbook = XLSX.read(buffer, { type: "array" });

  // Inspect all sheets
  console.log("Sheets:", workbook.SheetNames);

  const outputLines = [];
  const seen = new Set();

  // Each sheet has headers: ["Kód diagnózy", "Nazov", "Doplňujúce informácie"]
  // Rows include: ranges (A00-B99), categories (A00.-), and codes (A00.0)
  // We want categories + codes, skip ranges.

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rows.length === 0) continue;

    // Skip header row (first row is always column names)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;

      let code = String(row[0] || "").trim();
      const description = String(row[1] || "").trim();

      if (!code || !description) continue;

      // Skip range entries like "A00-B99", "A00-A09"
      if (/^[A-Z]\d{2}-[A-Z]\d{2}/.test(code)) continue;

      // Clean category codes: "A00.-" → "A00"
      code = code.replace(/\.-$/, "");

      // Must be a valid ICD code pattern: letter + 2+ digits, optionally with dot
      if (!/^[A-Z]\d{2}(\.\d+)?$/.test(code)) continue;

      // Deduplicate
      if (seen.has(code)) continue;
      seen.add(code);

      const truncated = description.substring(0, 40);
      const escaped = description.includes(",")
        ? `"${description}"` : description;
      outputLines.push(`${escaped},${code}-${truncated}`);
    }
  }

  if (outputLines.length === 0) {
    console.error("No entries extracted! Check the XLS structure.");
    // Dump first sheet structure for debugging
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log("First 5 rows of first sheet:");
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      console.log(`  Row ${i}:`, rows[i]);
    }
    process.exit(1);
  }

  writeFileSync(OUTPUT, outputLines.join("\n") + "\n", "utf-8");
  console.log(`Written ${outputLines.length} entries to ${OUTPUT}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
