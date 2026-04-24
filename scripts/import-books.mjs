#!/usr/bin/env node
/**
 * Import public-domain books into catalog_books from:
 *   - Project Gutenberg (via the Gutendex API — sorted by popularity)
 *   - Standard Ebooks (via their OPDS feed)
 *   - MEK (Magyar Elektronikus Könyvtár) (via OAI-PMH)
 *
 * Usage:
 *   pnpm import-books --source=gutenberg --limit=500
 *   pnpm import-books --source=standard-ebooks --limit=1000
 *   pnpm import-books --source=mek --limit=500 --dry-run
 *
 * Flags:
 *   --source   gutenberg | standard-ebooks | mek   (default: gutenberg)
 *   --limit    Max books to import this run         (default: 500)
 *   --dry-run  Print what would be inserted, no DB writes
 *
 * Credentials: put SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * `.env.local` (gitignored). The pnpm script loads it via
 * `node --env-file-if-exists`. Template: `.env.local.example`.
 *
 * Dedup: existing rows matched by (source, source_id). Re-running is
 * idempotent; only new books are inserted.
 *
 * The service-role key bypasses RLS — do NOT commit it anywhere.
 */

import { createClient } from "@supabase/supabase-js";

// ── CLI ────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const SOURCE = args.source ?? "gutenberg";
const LIMIT = Number(args.limit ?? 500);
const DRY_RUN = !!args["dry-run"];

// ── Supabase ───────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. " +
      "Get the service role key from Supabase dashboard → Settings → API.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Helpers ────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retries on transient failures (429, 5xx). */
async function fetchWithRetry(url, attempts = 3, delayMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "pnyxy-importer/1.0 (+https://pnyxy.com)" },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(delayMs * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(delayMs * (i + 1));
    }
  }
  throw new Error(`Failed after ${attempts} attempts: ${url}`);
}

/** Check which source_ids we've already imported so we skip them. */
async function existingSourceIds(source, ids) {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("catalog_books")
    .select("source_id")
    .eq("source", source)
    .in("source_id", ids);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.source_id));
}

async function insertBatch(rows) {
  if (DRY_RUN) {
    console.log(`[dry-run] Would insert ${rows.length} books`);
    console.log(rows.slice(0, 3));
    return;
  }
  const { error } = await supabase.from("catalog_books").insert(rows);
  if (error) throw error;
}

// ── Adapter: Project Gutenberg (via Gutendex) ──────────────
//
// Gutendex (https://gutendex.com) is a community-maintained JSON
// proxy over the Project Gutenberg catalog. It supports pagination
// and `?sort=popular` which returns books in download-count order —
// exactly the "most-read 500" cut we want.

async function importGutenberg(limit) {
  const pageSize = 32; // Gutendex returns 32 per page
  let pageUrl = "https://gutendex.com/books?sort=popular";
  let imported = 0;
  let seen = 0;

  while (pageUrl && imported < limit) {
    const res = await fetchWithRetry(pageUrl);
    const body = await res.json();
    const books = body.results ?? [];

    const candidates = books
      .map(gutendexToCatalog)
      .filter(Boolean);

    const sourceIds = candidates.map((c) => c.source_id);
    const already = await existingSourceIds("user_submitted", sourceIds);
    const fresh = candidates.filter((c) => !already.has(c.source_id));
    const slice = fresh.slice(0, limit - imported);

    if (slice.length > 0) {
      await insertBatch(slice);
      imported += slice.length;
    }
    seen += candidates.length;
    console.log(
      `Gutenberg: seen=${seen} imported=${imported}/${limit} (skipped ${
        candidates.length - fresh.length
      } already in catalog)`,
    );

    pageUrl = body.next;
    if (pageUrl) await sleep(300); // polite pause between pages
  }
  return imported;
}

/** Convert a Gutendex record to our CatalogBookInsert shape.
 *  Metadata-only records (no downloadable file) are allowed — they
 *  appear in browse with a "metadata only" badge and a null
 *  download_url. Copyright status is not filtered: Project Gutenberg
 *  by policy only hosts works it considers legally distributable in
 *  the US, so every PG record's file is redistributable. EU/HU
 *  re-distribution of a few edge-case works is still up to the
 *  operator's risk tolerance — see the README. */
function gutendexToCatalog(b) {
  if (!b?.id) return null;

  const formats = b.formats ?? {};
  // Prefer EPUB, then PDF, then plain text. HTML last-resort.
  // null is allowed — we'll import metadata-only.
  const download =
    formats["application/epub+zip"] ||
    formats["application/pdf"] ||
    formats["text/plain; charset=utf-8"] ||
    formats["text/plain"] ||
    formats["text/html"] ||
    null;

  const cover = formats["image/jpeg"] ?? null;
  const authors = (b.authors ?? []).map((a) => a.name).filter(Boolean);
  const languages = b.languages ?? [];
  const title = (b.title ?? "").trim();
  if (!title || authors.length === 0) return null;

  return {
    title,
    authors,
    description: b.summaries?.[0] ?? null,
    cover_url: cover,
    language: languages[0] ?? null,
    categories: b.subjects ?? [],
    source: "user_submitted",
    source_id: `pg:${b.id}`,
    download_url: download,
    status: "verified",
    verified_at: new Date().toISOString(),
  };
}

// ── Adapter: Standard Ebooks (OPDS) ────────────────────────
//
// Standard Ebooks publishes an OPDS Atom feed listing every title.
// The full catalog is ~1000 curated books so we pull the whole
// thing and the --limit flag acts as a cap, not a page size.
//
// Entries are Atom XML; we extract the handful of fields we need
// with regex. A proper XML parser would be safer but would add a
// dependency for a one-off script — the feed's shape is stable.

const SE_FEED_URL = "https://standardebooks.org/opds/all";

async function importStandardEbooks(limit) {
  const res = await fetchWithRetry(SE_FEED_URL);
  const xml = await res.text();
  const entries = xml.split(/<entry[\s>]/).slice(1);
  console.log(`Standard Ebooks: ${entries.length} entries in feed`);

  const candidates = entries.map(parseSEEntry).filter(Boolean);
  const sourceIds = candidates.map((c) => c.source_id);
  const already = await existingSourceIds("user_submitted", sourceIds);
  const fresh = candidates.filter((c) => !already.has(c.source_id));
  const slice = fresh.slice(0, limit);

  if (slice.length > 0) {
    // Batch inserts so we don't hit payload limits on a 1000-row insert.
    const BATCH = 100;
    for (let i = 0; i < slice.length; i += BATCH) {
      await insertBatch(slice.slice(i, i + BATCH));
      console.log(
        `Standard Ebooks: inserted ${Math.min(i + BATCH, slice.length)}/${slice.length}`,
      );
    }
  }
  console.log(
    `Standard Ebooks: imported ${slice.length} (skipped ${candidates.length - fresh.length} already in catalog)`,
  );
  return slice.length;
}

/** Parse one <entry>...</entry> block into a CatalogBookInsert. */
function parseSEEntry(chunk) {
  // Slice to just the contents up to </entry>
  const body = chunk.split("</entry>")[0];
  if (!body) return null;

  const title = matchXml(body, "title");
  if (!title) return null;

  // Authors appear as <author><name>...</name></author>, possibly many.
  const authors = [...body.matchAll(/<author>[\s\S]*?<name>([^<]+)<\/name>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (authors.length === 0) return null;

  // <id>url:standardebooks.org:ebooks/{slug}</id>  →  use the whole id as a stable source key
  const id = matchXml(body, "id");
  const slug = id?.replace(/^url:/, "") ?? id;
  if (!slug) return null;

  // Cover image: <link rel=".../image" href="..."/>
  const coverMatch = body.match(
    /<link[^>]*rel="[^"]*\/image"[^>]*href="([^"]+)"/,
  );
  const cover_url = coverMatch?.[1] ?? null;

  // EPUB download: <link rel=".../acquisition" type="application/epub+zip" href="..."/>
  // Prefer EPUB3 (the "kepub" / "azw3" variants are Kindle-specific).
  const epubLinks = [
    ...body.matchAll(
      /<link[^>]*rel="[^"]*\/acquisition"[^>]*type="application\/epub\+zip"[^>]*href="([^"]+)"/g,
    ),
  ].map((m) => m[1]);
  // Some feeds encode href before type — try the reverse order too.
  const epubLinks2 = [
    ...body.matchAll(
      /<link[^>]*type="application\/epub\+zip"[^>]*href="([^"]+)"/g,
    ),
  ].map((m) => m[1]);
  const download_url = epubLinks[0] ?? epubLinks2[0] ?? null;
  if (!download_url) return null;

  const description = matchXml(body, "summary") ?? matchXml(body, "content");
  const categories = [
    ...body.matchAll(/<category[^>]*term="([^"]+)"/g),
  ].map((m) => m[1]);

  const absCover = cover_url ? toAbsoluteSEUrl(cover_url) : null;
  const absDownload = toAbsoluteSEUrl(download_url);

  return {
    title: title.trim(),
    authors,
    description: description?.trim() ?? null,
    cover_url: absCover,
    language: "en",
    categories,
    source: "user_submitted",
    source_id: `se:${slug}`,
    download_url: absDownload,
    status: "verified",
    verified_at: new Date().toISOString(),
  };
}

function toAbsoluteSEUrl(href) {
  if (!href) return href;
  if (href.startsWith("http")) return href;
  return `https://standardebooks.org${href.startsWith("/") ? "" : "/"}${href}`;
}

/** Minimal XML tag extractor for non-nested tags. */
function matchXml(body, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = body.match(re);
  if (!m) return null;
  // Strip CDATA wrappers if present, decode common entities.
  return m[1]
    .replace(/<!\[CDATA\[|]]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── Adapter: MEK (Magyar Elektronikus Könyvtár) ────────────
//
// MEK doesn't have a modern REST API but does expose OAI-PMH
// (a standard digital-library harvesting protocol) at
// `http://mek.oszk.hu/oai.oai`. The protocol returns Dublin Core
// metadata in XML with resumption tokens for pagination.
//
// Caveats:
//   - Cover URLs aren't part of Dublin Core → cover_url is null.
//     Expect most MEK books to render without a cover image.
//   - dc:identifier is usually a page URL (e.g. https://mek.oszk.hu/00001/00001/)
//     not a direct EPUB/PDF. The real file lives at <identifier>/<id>.pdf
//     by convention; we set download_url to the page so the user
//     reaches MEK's own download picker.
//   - This adapter is untested against live MEK data — run with
//     --dry-run first and sanity-check a few records.

const MEK_OAI_URL =
  process.env.MEK_OAI_URL ?? "http://mek.oszk.hu/oai.oai";

async function importMEK(limit) {
  let imported = 0;
  let seen = 0;
  let token = null;
  let url = `${MEK_OAI_URL}?verb=ListRecords&metadataPrefix=oai_dc`;

  while (imported < limit) {
    const res = await fetchWithRetry(url);
    const xml = await res.text();

    const records = xml.split(/<record[\s>]/).slice(1);
    const candidates = records
      .map((chunk) => parseMEKRecord(chunk.split("</record>")[0]))
      .filter(Boolean);

    const sourceIds = candidates.map((c) => c.source_id);
    const already = await existingSourceIds("user_submitted", sourceIds);
    const fresh = candidates.filter((c) => !already.has(c.source_id));
    const slice = fresh.slice(0, limit - imported);

    if (slice.length > 0) {
      await insertBatch(slice);
      imported += slice.length;
    }
    seen += candidates.length;
    console.log(
      `MEK: seen=${seen} imported=${imported}/${limit} (skipped ${candidates.length - fresh.length})`,
    );

    // Extract resumption token for the next page.
    const tokenMatch = xml.match(
      /<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/,
    );
    token = tokenMatch?.[1] ?? null;
    if (!token) break;
    url = `${MEK_OAI_URL}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`;
    await sleep(500); // be kind to a small public server
  }
  return imported;
}

/**
 * Parse one OAI-PMH record into a CatalogBookInsert. Each record has
 * a <header> (with <identifier>, <setSpec>) and <metadata> containing
 * <oai_dc:dc> with a flat list of Dublin Core elements.
 */
function parseMEKRecord(body) {
  if (!body) return null;

  const oaiIdentifier = matchXml(body, "identifier");
  if (!oaiIdentifier) return null;

  const title = matchXml(body, "dc:title") ?? matchXml(body, "title");
  if (!title) return null;

  // dc:creator may appear multiple times → collect all
  const authors = [
    ...body.matchAll(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/g),
  ]
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (authors.length === 0) return null;

  const description = matchXml(body, "dc:description");
  const language = matchXml(body, "dc:language") ?? "hu";
  const subjects = [
    ...body.matchAll(/<dc:subject[^>]*>([\s\S]*?)<\/dc:subject>/g),
  ].map((m) => m[1].trim());

  // dc:identifier inside metadata (not the OAI header one) is usually
  // the URL to the book's MEK landing page.
  const urls = [
    ...body.matchAll(/<dc:identifier[^>]*>([\s\S]*?)<\/dc:identifier>/g),
  ]
    .map((m) => m[1].trim())
    .filter((u) => /^https?:/.test(u));
  const landingUrl = urls[0] ?? null;
  if (!landingUrl) return null;

  return {
    title: title.trim(),
    authors,
    description: description?.trim() ?? null,
    cover_url: null,
    language,
    categories: subjects,
    source: "user_submitted",
    // Use the OAI identifier as our source key — stable per record.
    source_id: `mek:${oaiIdentifier.trim()}`,
    download_url: landingUrl,
    status: "verified",
    verified_at: new Date().toISOString(),
  };
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  console.log(
    `Source=${SOURCE}  Limit=${LIMIT}  DryRun=${DRY_RUN}  URL=${SUPABASE_URL}`,
  );
  let count = 0;
  try {
    if (SOURCE === "gutenberg") count = await importGutenberg(LIMIT);
    else if (SOURCE === "standard-ebooks")
      count = await importStandardEbooks(LIMIT);
    else if (SOURCE === "mek") count = await importMEK(LIMIT);
    else {
      console.error(`Unknown --source=${SOURCE}`);
      process.exit(1);
    }
    console.log(`\nDone. Imported ${count} books.`);
  } catch (err) {
    console.error("Import failed:", err);
    process.exit(1);
  }
}

main();
