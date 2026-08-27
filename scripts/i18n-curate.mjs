#!/usr/bin/env node
// Curates the i18n locale files so en.json / hu.json become the single
// source of truth for translated strings, instead of `defaultValue` options
// scattered across t() call sites.
//
// For every `t("some.key", { ..., defaultValue: "Text", ... })` call found
// under src/**/*.{ts,tsx}:
//   - if "some.key" is missing from src/locales/en.json, it is inserted
//     there with the literal defaultValue text;
//   - if "some.key" is missing from src/locales/hu.json, the same English
//     text is inserted there too (a placeholder until someone translates
//     it) and the key is recorded in scripts/i18n-untranslated.txt;
//   - the `defaultValue` property is then stripped from the call site's
//     options object (dropping the whole second argument if it was the
//     only option).
//
// Only calls whose key AND defaultValue are plain string literals are
// touched. Anything dynamic (template-literal keys with interpolation,
// computed defaultValues, etc.) is left alone and reported as skipped.
//
// Usage: node scripts/i18n-curate.mjs   (rerun any time; it is idempotent)

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { dirname, join, relative, extname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "src");
const enPath = join(root, "src/locales/en.json");
const huPath = join(root, "src/locales/hu.json");
const reportPath = join(root, "scripts/i18n-untranslated.txt");

// ---------------------------------------------------------------------
// Low-level, string/comment-aware source scanning helpers.
// ---------------------------------------------------------------------

/** Given text[i] === a quote char, returns the index just past the matching
 *  closing quote, correctly skipping escaped chars and (for template
 *  literals) nested ${...} expressions. */
function skipString(text, i) {
  const quote = text[i];
  i++;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && text[i + 1] === "{") {
      const close = findMatchingBracket(text, i + 1);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    i++;
  }
  return i;
}

/** Given text[openIndex] is one of ( { [, returns the index of the matching
 *  close bracket, skipping over strings/comments/nested brackets. -1 if
 *  unmatched (malformed source). */
function findMatchingBracket(text, openIndex) {
  const open = text[openIndex];
  const close = { "(": ")", "{": "}", "[": "]" }[open];
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const ce = text.indexOf("*/", i + 2);
      i = ce === -1 ? text.length : ce + 2;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Returns absolute indices of all occurrences of chars in `chars` that sit
 *  at top-level (bracket depth 0) within [start, end), skipping strings and
 *  comments. */
function findTopLevelChars(text, start, end, chars) {
  const positions = [];
  let depth = 0;
  let i = start;
  while (i < end) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 || nl > end ? end : nl;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const ce = text.indexOf("*/", i + 2);
      i = ce === -1 || ce + 2 > end ? end : ce + 2;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && chars.includes(ch)) positions.push(i);
    i++;
  }
  return positions;
}

/** Splits [start, end) into top-level comma-separated segments, returned as
 *  {start, end, commaAfter} where commaAfter is the absolute index of the
 *  comma terminating the segment, or null for the last one. */
function splitTopLevelSegments(text, start, end) {
  const commas = findTopLevelChars(text, start, end, [","]);
  const segments = [];
  let prevEnd = start;
  for (const pos of commas) {
    segments.push({ start: prevEnd, end: pos, commaAfter: pos });
    prevEnd = pos + 1;
  }
  segments.push({ start: prevEnd, end, commaAfter: null });
  return segments;
}

/** Parses `raw` (already isolated, e.g. one arg or one property value) as a
 *  single string literal ("...", '...' or a `...` with no ${} interpolation)
 *  spanning the entire trimmed text. Returns the unescaped string value, or
 *  null if `raw` is not a pure string literal. */
function parseStaticString(raw) {
  const s = raw.trim();
  if (s.length < 2) return null;
  const quote = s[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  const endIdx = skipString(s, 0);
  if (endIdx !== s.length) return null; // trailing content -> not a pure literal (e.g. concatenation)
  const inner = s.slice(1, -1);
  if (quote === "`") {
    let i = 0;
    while (i < inner.length) {
      if (inner[i] === "\\") {
        i += 2;
        continue;
      }
      if (inner[i] === "$" && inner[i + 1] === "{") return null;
      i++;
    }
  }
  return unescapeJsString(inner);
}

function unescapeJsString(inner) {
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = inner[i + 1];
    i++;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "v":
        out += "\v";
        break;
      case "0":
        out += "\0";
        break;
      case "\\":
        out += "\\";
        break;
      case "'":
        out += "'";
        break;
      case '"':
        out += '"';
        break;
      case "`":
        out += "`";
        break;
      case "\n":
        // line continuation: swallow, no char emitted
        break;
      case "u": {
        if (inner[i + 1] === "{") {
          const close = inner.indexOf("}", i + 2);
          if (close === -1) {
            out += "u";
            break;
          }
          const hex = inner.slice(i + 2, close);
          out += String.fromCodePoint(parseInt(hex, 16));
          i = close;
        } else {
          const hex = inner.slice(i + 1, i + 5);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        }
        break;
      }
      case "x": {
        const hex = inner.slice(i + 1, i + 3);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (ext === ".ts" || ext === ".tsx") out.push(full);
    }
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

// ---------------------------------------------------------------------
// Call-site extraction
// ---------------------------------------------------------------------

const CALL_RE = /(?:i18next\.t|i18n\.t|(?<![.\w$])t)\(/g;

/**
 * Scans one file's text for t(...) calls carrying a static `defaultValue`.
 * Returns { candidates, ignoredNonObjectArg } where each candidate is:
 *   { key, defaultValueText, keyRaw, line, removalStart, removalEnd }
 * removalStart/removalEnd delimit the exact span to delete from the source
 * to strip the defaultValue property (or the whole 2nd argument).
 * Calls with a defaultValue property that could not be statically resolved
 * are returned in `skipped` with a reason.
 */
function extractCalls(text) {
  const candidates = [];
  const skipped = [];
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(text))) {
    const openParen = m.index + m[0].length - 1; // index of '('
    const closeParen = findMatchingBracket(text, openParen);
    if (closeParen === -1) continue; // malformed, bail on this call

    const args = splitTopLevelSegments(text, openParen + 1, closeParen).filter(
      (seg) => text.slice(seg.start, seg.end).trim().length > 0,
    );
    if (args.length === 0) continue;

    const keyRaw = text.slice(args[0].start, args[0].end);
    const keyValue = parseStaticString(keyRaw);

    if (args.length < 2) continue; // no options object at all -> nothing to migrate

    const optRaw = text.slice(args[1].start, args[1].end);
    const optTrim = optRaw.trim();
    if (!optTrim.startsWith("{") || !optTrim.endsWith("}")) continue; // not an object literal, nothing to migrate

    // Locate the actual { and } within args[1] (accounting for surrounding whitespace).
    const objStart = args[1].start + optRaw.indexOf("{");
    const objEnd = args[1].start + optRaw.lastIndexOf("}");
    if (findMatchingBracket(text, objStart) !== objEnd) continue; // sanity check, shouldn't happen

    const bodyStart = objStart + 1;
    const bodyEnd = objEnd;
    const rawSegments = splitTopLevelSegments(text, bodyStart, bodyEnd);
    const propSegments = rawSegments.filter(
      (seg) => text.slice(seg.start, seg.end).trim().length > 0,
    );

    // Find the defaultValue property among the real (non-empty) segments.
    let targetRawIdx = -1; // index into rawSegments
    let targetPropCountAmongReal = 0;
    for (let ri = 0; ri < rawSegments.length; ri++) {
      const seg = rawSegments[ri];
      const segText = text.slice(seg.start, seg.end);
      if (!segText.trim()) continue;
      const colonPositions = findTopLevelChars(text, seg.start, seg.end, [":"]);
      if (colonPositions.length === 0) continue; // shorthand or spread, not defaultValue: ...
      const colonPos = colonPositions[0];
      const keyPart = text.slice(seg.start, colonPos).trim();
      const propKey =
        keyPart === "defaultValue" ? "defaultValue" : parseStaticString(keyPart);
      if (propKey === "defaultValue") {
        targetRawIdx = ri;
        break;
      }
    }

    if (targetRawIdx === -1) continue; // no defaultValue in this call, nothing to migrate

    const line = lineOf(text, m.index);

    if (keyValue === null) {
      skipped.push({
        line,
        reason: `dynamic key (not a static string literal): ${keyRaw.trim().slice(0, 80)}`,
      });
      continue;
    }

    const targetSeg = rawSegments[targetRawIdx];
    const colonPositions = findTopLevelChars(text, targetSeg.start, targetSeg.end, [":"]);
    const colonPos = colonPositions[0];
    const valueRaw = text.slice(colonPos + 1, targetSeg.end);
    const defaultValueText = parseStaticString(valueRaw);

    if (defaultValueText === null) {
      skipped.push({
        line,
        reason: `defaultValue is not a static string literal for key "${keyValue}"`,
      });
      continue;
    }

    // Determine removal span.
    const realCount = propSegments.length;
    let removalStart, removalEnd;
    if (realCount <= 1) {
      // defaultValue is the only real option -> drop the whole 2nd argument.
      removalStart = args[0].end;
      removalEnd = closeParen;
    } else if (targetSeg.commaAfter !== null) {
      removalStart = targetSeg.start;
      removalEnd = targetSeg.commaAfter + 1;
    } else {
      // last segment, no trailing comma after it -> also eat the preceding comma.
      removalStart = rawSegments[targetRawIdx - 1].commaAfter;
      removalEnd = targetSeg.end;
    }

    candidates.push({
      key: keyValue,
      defaultValueText,
      line,
      removalStart,
      removalEnd,
    });
  }
  return { candidates, skipped };
}

// ---------------------------------------------------------------------
// Locale JSON path resolution
// ---------------------------------------------------------------------

function resolvePath(root, keyParts) {
  let cur = root;
  for (let i = 0; i < keyParts.length - 1; i++) {
    const part = keyParts[i];
    if (!(part in cur)) {
      const captured = cur;
      return {
        status: "missing",
        insert(value) {
          let node = captured;
          for (let j = i; j < keyParts.length - 1; j++) {
            node[keyParts[j]] = {};
            node = node[keyParts[j]];
          }
          node[keyParts[keyParts.length - 1]] = value;
        },
      };
    }
    const next = cur[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return { status: "conflict", path: keyParts.slice(0, i + 1).join(".") };
    }
    cur = next;
  }
  const leaf = keyParts[keyParts.length - 1];
  if (leaf in cur) return { status: "exists" };
  const captured = cur;
  return {
    status: "missing",
    insert(value) {
      captured[leaf] = value;
    },
  };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

function main() {
  const enRoot = JSON.parse(readFileSync(enPath, "utf8"));
  const huRoot = JSON.parse(readFileSync(huPath, "utf8"));

  const files = walk(srcDir, []);

  let callsFound = 0;
  let keysAddedToEn = 0;
  let keysAddedToHu = 0;
  let filesRewritten = 0;
  const skippedCalls = []; // { file, line, reason }
  const huConflicts = []; // { file, line, key, path }
  const untranslated = new Set();
  const firstDefaultValueByKey = new Map();
  let duplicateMismatches = 0;
  const rewrittenFiles = [];

  for (const file of files) {
    const relPath = relative(root, file);
    const text = readFileSync(file, "utf8");
    const { candidates, skipped } = extractCalls(text);

    for (const s of skipped) {
      skippedCalls.push({ file: relPath, line: s.line, reason: s.reason });
    }

    if (candidates.length === 0) continue;

    const edits = []; // { start, end }

    for (const c of candidates) {
      callsFound++;

      if (firstDefaultValueByKey.has(c.key)) {
        if (firstDefaultValueByKey.get(c.key) !== c.defaultValueText) duplicateMismatches++;
      } else {
        firstDefaultValueByKey.set(c.key, c.defaultValueText);
      }

      const keyParts = c.key.split(".");

      const enResolved = resolvePath(enRoot, keyParts);
      if (enResolved.status === "conflict") {
        skippedCalls.push({
          file: relPath,
          line: c.line,
          reason: `en.json path "${enResolved.path}" already holds a non-object value; cannot insert key "${c.key}"`,
        });
        continue;
      }
      if (enResolved.status === "missing") {
        enResolved.insert(c.defaultValueText);
        keysAddedToEn++;
      }

      const huResolved = resolvePath(huRoot, keyParts);
      if (huResolved.status === "conflict") {
        huConflicts.push({ file: relPath, line: c.line, key: c.key, path: huResolved.path });
      } else if (huResolved.status === "missing") {
        huResolved.insert(c.defaultValueText);
        keysAddedToHu++;
        untranslated.add(c.key);
      }

      // en.json now has (or already had) this key -> safe to strip defaultValue from source.
      edits.push({ start: c.removalStart, end: c.removalEnd });
    }

    if (edits.length === 0) continue;

    edits.sort((a, b) => b.start - a.start);
    let newText = text;
    for (const e of edits) {
      newText = newText.slice(0, e.start) + newText.slice(e.end);
    }
    if (newText !== text) {
      writeFileSync(file, newText, "utf8");
      filesRewritten++;
      rewrittenFiles.push(file);
    }
  }

  writeFileSync(enPath, JSON.stringify(enRoot, null, 2) + "\n", "utf8");
  writeFileSync(huPath, JSON.stringify(huRoot, null, 2) + "\n", "utf8");

  const untranslatedList = Array.from(untranslated).sort((a, b) => a.localeCompare(b));
  writeFileSync(reportPath, untranslatedList.map((k) => k + "\n").join(""), "utf8");

  // Run prettier on the files we actually rewrote, if available.
  let prettierRan = false;
  if (rewrittenFiles.length > 0) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const hasPrettier =
      (pkg.devDependencies && pkg.devDependencies.prettier) ||
      (pkg.dependencies && pkg.dependencies.prettier);
    if (hasPrettier) {
      try {
        execFileSync(
          "pnpm",
          ["exec", "prettier", "--write", ...rewrittenFiles.map((f) => relative(root, f))],
          { cwd: root, stdio: "pipe" },
        );
        prettierRan = true;
      } catch (err) {
        console.error("prettier --write failed on rewritten files:");
        console.error(err.stdout ? err.stdout.toString() : err.message);
      }
    }
  }

  console.log("i18n-curate summary");
  console.log("====================");
  console.log(`t() calls with defaultValue found: ${callsFound}`);
  console.log(`keys added to en.json: ${keysAddedToEn}`);
  console.log(`keys added to hu.json: ${keysAddedToHu} (written to ${relative(root, reportPath)})`);
  console.log(`files rewritten: ${filesRewritten}`);
  console.log(`prettier applied to rewritten files: ${prettierRan ? "yes" : "no"}`);
  if (duplicateMismatches > 0) {
    console.log(
      `duplicate keys with differing defaultValue text across call sites: ${duplicateMismatches} (first occurrence's text was kept)`,
    );
  }
  if (huConflicts.length > 0) {
    console.log(`\nhu.json path conflicts (key left untranslated, source still rewritten): ${huConflicts.length}`);
    for (const c of huConflicts) {
      console.log(`  ${c.file}:${c.line} key "${c.key}" -> hu.json path "${c.path}" is a non-object value`);
    }
  }
  console.log(`\nskipped calls: ${skippedCalls.length}`);
  for (const s of skippedCalls) {
    console.log(`  ${s.file}:${s.line} ${s.reason}`);
  }
}

main();
