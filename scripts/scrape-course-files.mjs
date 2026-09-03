#!/usr/bin/env node
// Grab downloadable course materials (PDF/PPT/DOC/ZIP) linked from one or
// more course web pages into a local folder, so they can be reviewed and
// then uploaded to a Pnyxy course space.
//
// This is a plain link-scraper: it fetches each page's HTML, pulls every
// <a href> that points at a document, resolves relative links, and
// downloads same-file assets. It does NOT log in anywhere and it does NOT
// follow the site recursively, so pages behind a login (or files only
// reachable by clicking through several pages) won't be picked up; for
// those, save the files by hand into the output folder.
//
// Usage:
//   node scripts/scrape-course-files.mjs <pageUrl> [morePageUrls...] [--out DIR] [--ext pdf,pptx,zip] [--all-origins] [--dry]
//
// Examples:
//   node scripts/scrape-course-files.mjs https://cs.bme.hu/bsz1/ --out ./bsz1-files
//   node scripts/scrape-course-files.mjs https://.../eloadasok https://.../gyakorlatok --out ./bsz1-files
//   node scripts/scrape-course-files.mjs https://cs.bme.hu/bsz1/ --dry     # list only, download nothing
//
// Node 20+ (uses global fetch). No dependencies.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename, extname } from "node:path";

const DEFAULT_EXT = ["pdf", "ppt", "pptx", "doc", "docx", "zip", "djvu", "ps"];

function parseArgs(argv) {
  const pages = [];
  let out = "./course-files";
  let ext = DEFAULT_EXT;
  let allOrigins = false;
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = argv[++i];
    else if (a === "--ext") ext = argv[++i].split(",").map((s) => s.trim().toLowerCase());
    else if (a === "--all-origins") allOrigins = true;
    else if (a === "--dry") dry = true;
    else if (a.startsWith("http")) pages.push(a);
    else console.warn(`(ignoring unknown arg: ${a})`);
  }
  return { pages, out, ext, allOrigins, dry };
}

// Minimal, dependency-free href extraction: matches href="..." / href='...'.
function extractHrefs(html) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function decodeName(pathname) {
  try {
    return decodeURIComponent(basename(pathname));
  } catch {
    return basename(pathname);
  }
}

async function main() {
  const { pages, out, ext, allOrigins, dry } = parseArgs(process.argv.slice(2));
  if (pages.length === 0) {
    console.error(
      "Adj meg legalább egy oldal-URL-t.\n" +
        "  node scripts/scrape-course-files.mjs <pageUrl> [--out DIR] [--ext pdf,pptx] [--all-origins] [--dry]",
    );
    process.exit(1);
  }

  const outDir = resolve(process.cwd(), out);
  const extSet = new Set(ext);
  const found = new Map(); // absUrl -> { name, fromPage }

  for (const pageUrl of pages) {
    process.stdout.write(`\n▶ Oldal: ${pageUrl}\n`);
    let html;
    try {
      const res = await fetch(pageUrl, {
        headers: { "user-agent": "Mozilla/5.0 (PnyxyCourseScraper)" },
      });
      if (!res.ok) {
        console.warn(`  ! HTTP ${res.status} ${res.statusText} - kihagyva`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      console.warn(`  ! nem sikerült letölteni: ${err.message}`);
      continue;
    }

    const base = new URL(pageUrl);
    for (const href of extractHrefs(html)) {
      let abs;
      try {
        abs = new URL(href, base);
      } catch {
        continue;
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      const e = extname(abs.pathname).replace(/^\./, "").toLowerCase();
      if (!extSet.has(e)) continue;
      if (!allOrigins && abs.host !== base.host) continue;
      const url = abs.href.split("#")[0];
      if (!found.has(url)) found.set(url, { name: decodeName(abs.pathname), fromPage: pageUrl });
    }
  }

  if (found.size === 0) {
    console.log(
      "\nNem találtam letölthető fájlt. Lehet, hogy a fájlok login mögött vannak,\n" +
        "vagy nem közvetlen linkként szerepelnek. Próbáld a konkrét al-oldalak URL-jeivel,\n" +
        "vagy add hozzá a --all-origins kapcsolót (más domainen tárolt fájlokhoz).",
    );
    return;
  }

  console.log(`\n=== ${found.size} fájl-link ===`);
  let idx = 0;
  const manifest = [];
  for (const [url, meta] of found) {
    idx++;
    console.log(`  ${String(idx).padStart(2, " ")}. ${meta.name}  <-  ${url}`);
    manifest.push({ name: meta.name, url, fromPage: meta.fromPage });
  }

  if (dry) {
    console.log("\n(--dry: nem töltök le semmit.)");
    return;
  }

  await mkdir(outDir, { recursive: true });
  console.log(`\n=== Letöltés ide: ${outDir} ===`);
  let ok = 0;
  const seen = new Set();
  for (const [url, meta] of found) {
    // avoid overwriting files that share a basename across sections
    let name = meta.name || "file";
    if (seen.has(name)) {
      const stem = name.slice(0, name.length - extname(name).length);
      name = `${stem}-${Math.random().toString(36).slice(2, 6)}${extname(name)}`;
    }
    seen.add(name);
    const dest = join(outDir, name);
    if (existsSync(dest)) {
      console.log(`  = már megvan: ${name}`);
      ok++;
      continue;
    }
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (PnyxyCourseScraper)" },
      });
      if (!res.ok) {
        console.warn(`  ! ${name}: HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      console.log(`  ✓ ${name}  (${(buf.length / 1024).toFixed(0)} kB)`);
      ok++;
    } catch (err) {
      console.warn(`  ! ${name}: ${err.message}`);
    }
  }

  await writeFile(join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nKész: ${ok}/${found.size} fájl. Manifest: ${join(outDir, "_manifest.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
