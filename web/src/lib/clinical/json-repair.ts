/**
 * Robust JSON extraction and parsing from LLM output.
 *
 * LLMs frequently produce almost-valid JSON with issues like:
 * - Unescaped newlines inside string values
 * - Trailing commas before } or ]
 * - Unescaped control characters
 * - Markdown code-block wrappers (```json ... ```)
 * - Smart/curly quotes instead of straight quotes
 */

/**
 * Extract and parse JSON from a text string that may contain
 * surrounding text, markdown, or other artifacts.
 *
 * @throws Error if no valid JSON can be recovered
 */
export function extractJson<T = unknown>(text: string): T {
  // Strip markdown code fences
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/gm, "")
    .replace(/\n?```\s*$/gm, "");

  // Try direct match + parse first (fast path)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      // Fall through to repair
    }

    // Attempt repair on the extracted block
    const repaired = repairJsonString(jsonMatch[0]);
    try {
      return JSON.parse(repaired) as T;
    } catch {
      // Fall through to aggressive repair
    }

    // Aggressive: try to fix unescaped content inside string values
    const aggressive = aggressiveRepair(jsonMatch[0]);
    try {
      return JSON.parse(aggressive) as T;
    } catch (err) {
      throw new Error(
        `JSON repair failed: ${err instanceof Error ? err.message : "Unknown error"}. ` +
          `First 200 chars: ${jsonMatch[0].slice(0, 200)}`,
      );
    }
  }

  throw new Error("No JSON object found in response");
}

/**
 * Light repairs for common LLM JSON mistakes.
 */
function repairJsonString(json: string): string {
  let s = json;

  // Replace smart quotes with straight quotes
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, "$1");

  // Fix unescaped newlines inside JSON strings by walking through the string
  s = fixUnescapedNewlines(s);

  return s;
}

/**
 * Walk through JSON and escape literal newlines found inside string values.
 */
function fixUnescapedNewlines(json: string): string {
  const chars: string[] = [];
  let inString = false;
  let i = 0;

  while (i < json.length) {
    const ch = json[i];

    if (inString) {
      if (ch === "\\") {
        // Escaped character — pass through both chars
        chars.push(ch);
        i++;
        if (i < json.length) {
          chars.push(json[i]);
        }
        i++;
        continue;
      }

      if (ch === '"') {
        inString = false;
        chars.push(ch);
        i++;
        continue;
      }

      // Replace literal newline/tab inside strings with escape sequences
      if (ch === "\n") {
        chars.push("\\n");
        i++;
        continue;
      }
      if (ch === "\r") {
        chars.push("\\r");
        i++;
        continue;
      }
      if (ch === "\t") {
        chars.push("\\t");
        i++;
        continue;
      }

      chars.push(ch);
      i++;
    } else {
      if (ch === '"') {
        inString = true;
      }
      chars.push(ch);
      i++;
    }
  }

  return chars.join("");
}

/**
 * Aggressive repair: re-extract key-value pairs using regex patterns.
 * Falls back to building a new JSON object from detected "key": "value" pairs.
 */
function aggressiveRepair(json: string): string {
  // First try the newline + trailing comma fix
  let s = json;
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
  s = s.replace(/,\s*([\]}])/g, "$1");

  // Try to fix the specific position where the error occurs
  // by escaping any unescaped quotes within string values
  s = fixUnescapedNewlines(s);

  // Try to escape unescaped quotes within values
  // This is done by tracking string state and fixing mismatched quotes
  s = fixUnescapedQuotes(s);

  return s;
}

/**
 * Attempt to fix unescaped quotes inside JSON string values.
 * Uses heuristics: if we encounter a " that doesn't look like a
 * key-value separator or structural element, escape it.
 */
function fixUnescapedQuotes(json: string): string {
  const result: string[] = [];
  let i = 0;
  let inString = false;
  while (i < json.length) {
    const ch = json[i];

    if (!inString) {
      result.push(ch);
      if (ch === '"') inString = true;
      i++;
    } else {
      if (ch === "\\") {
        result.push(ch);
        i++;
        if (i < json.length) {
          result.push(json[i]);
          i++;
        }
        continue;
      }

      if (ch === '"') {
        // Check if this quote ends the string or is embedded
        const after = json.slice(i + 1).trimStart();
        if (
          after.startsWith(":") ||
          after.startsWith(",") ||
          after.startsWith("}") ||
          after.startsWith("]") ||
          after.length === 0
        ) {
          // This is a structural closing quote
          inString = false;
          result.push(ch);
        } else {
          // Likely an unescaped quote inside a value — escape it
          result.push('\\"');
        }
        i++;
        continue;
      }

      if (ch === "\n") {
        result.push("\\n");
        i++;
        continue;
      }
      if (ch === "\r") {
        result.push("\\r");
        i++;
        continue;
      }
      if (ch === "\t") {
        result.push("\\t");
        i++;
        continue;
      }

      result.push(ch);
      i++;
    }
  }

  return result.join("");
}
