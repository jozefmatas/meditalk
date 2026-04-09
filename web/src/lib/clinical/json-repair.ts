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

  // Find the JSON payload. If we have a complete "{...}" block, use it.
  // Otherwise (truncated output — no trailing brace), take everything from
  // the first `{` to the end of the text and let the truncation-recovery
  // stage close it for us.
  const fullMatch = cleaned.match(/\{[\s\S]*\}/);
  let jsonStr: string;
  if (fullMatch) {
    jsonStr = fullMatch[0];
  } else {
    const start = cleaned.indexOf("{");
    if (start < 0) {
      throw new Error("No JSON object found in response");
    }
    jsonStr = cleaned.slice(start);
  }

  // Stage 1 — direct parse (fast path for clean JSON)
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Fall through
  }

  // Stage 2 — light repair (smart quotes, trailing commas, unescaped newlines)
  try {
    return JSON.parse(repairJsonString(jsonStr)) as T;
  } catch {
    // Fall through
  }

  // Stage 3 — aggressive repair (escape stray quotes inside string values)
  try {
    return JSON.parse(aggressiveRepair(jsonStr)) as T;
  } catch {
    // Fall through
  }

  // Stage 4 — truncation recovery. When the LLM hits its max_tokens cap the
  // output stops mid-token; close any open strings/arrays/objects at the
  // last known-safe cut point so we recover the partial facts instead of
  // losing the entire response.
  try {
    return JSON.parse(closeTruncatedJson(jsonStr)) as T;
  } catch {
    // Fall through
  }

  // Stage 5 — truncation recovery on top of aggressive repair (handles both
  // at once, e.g. an unescaped quote inside a truncated string)
  try {
    return JSON.parse(closeTruncatedJson(aggressiveRepair(jsonStr))) as T;
  } catch (err) {
    throw new Error(
      `JSON repair failed: ${err instanceof Error ? err.message : "Unknown error"}. ` +
        `First 200 chars: ${jsonStr.slice(0, 200)}`,
    );
  }
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

/**
 * Recover from a truncated JSON payload (LLM hit its max_tokens cap
 * mid-output). We walk the string forward, tracking open containers and
 * string state, and remember the position after each completed *value*
 * (string, number, boolean, null, closed inner object/array) while still
 * inside at least one outer container. When the walk finishes with open
 * containers or an unterminated string, we truncate back to the last such
 * "safe" position, drop any trailing comma, and close the remaining open
 * containers LIFO.
 *
 * Exported for testing.
 */
export function closeTruncatedJson(json: string): string {
  type Closer = "}" | "]";
  const stack: Closer[] = [];
  const snapshots: { pos: number; stack: Closer[] }[] = [];

  let inString = false;
  let escaped = false;
  let i = 0;
  const len = json.length;

  const snapshot = (pos: number) => {
    if (stack.length > 0) {
      snapshots.push({ pos, stack: [...stack] });
    }
  };

  while (i < len) {
    const ch = json[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
        // Distinguish "key" from "value" by lookahead: a key is followed by
        // `:` (optionally preceded by whitespace). We only snapshot when we
        // can see a non-`:` delimiter after the closing quote — if the
        // input ended right at the closing quote we can't tell key from
        // value, so we skip the snapshot.
        let j = i + 1;
        while (j < len && /\s/.test(json[j])) j++;
        if (j < len && json[j] !== ":") {
          snapshot(i + 1);
        }
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      i++;
      continue;
    }

    if (ch === "{") {
      stack.push("}");
      i++;
      continue;
    }

    if (ch === "[") {
      stack.push("]");
      i++;
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
        snapshot(i + 1);
      }
      i++;
      continue;
    }

    // Numbers (including negatives, decimals, exponents).
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      while (i < len && /[-+0-9.eE]/.test(json[i])) i++;
      // Only count as a completed value if the number was followed by a
      // delimiter within the input (otherwise it may still be truncated).
      if (i < len && i > start) {
        snapshot(i);
      }
      continue;
    }

    // Literals: true / false / null.
    if (ch === "t" && json.slice(i, i + 4) === "true") {
      i += 4;
      snapshot(i);
      continue;
    }
    if (ch === "f" && json.slice(i, i + 5) === "false") {
      i += 5;
      snapshot(i);
      continue;
    }
    if (ch === "n" && json.slice(i, i + 4) === "null") {
      i += 4;
      snapshot(i);
      continue;
    }

    // Whitespace, commas, colons — skip.
    i++;
  }

  // If the walk finished cleanly, nothing to recover.
  if (!inString && stack.length === 0) {
    return json;
  }

  if (snapshots.length === 0) {
    // Nothing salvageable — return the input unchanged and let the outer
    // JSON.parse fail so the caller sees a meaningful error rather than a
    // silent empty object.
    return json;
  }

  const snap = snapshots[snapshots.length - 1];
  let truncated = json.slice(0, snap.pos);
  // Drop any trailing comma/whitespace left dangling by the cut.
  truncated = truncated.replace(/[,\s]+$/, "");
  // Close remaining open containers in LIFO order.
  for (let k = snap.stack.length - 1; k >= 0; k--) {
    truncated += snap.stack[k];
  }
  return truncated;
}
