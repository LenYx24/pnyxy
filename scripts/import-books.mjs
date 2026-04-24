#!/usr/bin/env node
/**
 * Import books into catalog_books from:
 *   - Project Gutenberg (via the Gutendex API — sorted by popularity)
 *     Full text + metadata for public-domain books.
 *   - Standard Ebooks (via their OPDS feed)
 *     Full text + metadata; requires Patrons Circle membership.
 *   - MEK (Magyar Elektronikus Könyvtár) (via OAI-PMH)
 *     Hungarian public-domain; requires MEK_OAI_URL env var.
 *   - Open Library (via their search API)
 *     **Metadata only** — title/author/cover/description/ISBN. No
 *     file is distributed. Perfect for seeding in-copyright titles
 *     (Harry Potter, textbooks, contemporary fiction) so users can
 *     still use annotations / notes / forum / streaks without us
 *     redistributing the book.
 *
 * Usage:
 *   pnpm import-books --source=gutenberg --limit=500
 *   pnpm import-books --source=open-library --query="bestseller" --limit=200
 *   pnpm import-books --source=open-library --query="philosophy" --limit=100
 *   pnpm import-books --source=standard-ebooks --limit=1000
 *   pnpm import-books --source=mek --limit=500 --dry-run
 *
 * Flags:
 *   --source   gutenberg | standard-ebooks | mek | open-library  (default: gutenberg)
 *   --limit    Max books to import this run         (default: 500)
 *   --query    Open Library search query (required for --source=open-library)
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
// **HEADS UP**: Standard Ebooks gated their OPDS catalog behind
// Patrons Circle membership (a donation tier) sometime in 2024/25.
// Both `/opds/all` and `/feeds/opds/new-releases` now return 401 to
// unauthenticated requests. To import from SE you need to either:
//
//   a) Become a Patron and set SE_EMAIL in .env.local. The password
//      field is empty — SE uses Basic auth with <email>: as creds.
//
//   b) Clone specific books from their GitHub org
//      (github.com/standardebooks) and upload by hand.
//
// If SE_EMAIL is unset, the import fails fast with a hint.
//
// The feed URL candidates below are tried in order; the first one
// that returns 200 wins. SE has reorganized these paths a few times,
// so being tolerant is cheap insurance.

const SE_FEED_URL_CANDIDATES = [
  "https://standardebooks.org/feeds/opds/all",
  "https://standardebooks.org/opds/all",
  "https://standardebooks.org/feeds/opds/new-releases",
];

async function importStandardEbooks(limit) {
  const email = process.env.SE_EMAIL;
  if (!email) {
    console.error(
      "Standard Ebooks requires Patrons Circle authentication.\n" +
        "Set SE_EMAIL=<your-patron-email> in .env.local, then re-run.\n" +
        "(Password field is intentionally empty — SE uses Basic auth\n" +
        "with the email as the username.)\n" +
        "Sign up at https://standardebooks.org/donate",
    );
    return 0;
  }
  const authHeader = `Basic ${Buffer.from(`${email}:`).toString("base64")}`;

  let feedUrl = null;
  let xml = null;
  for (const candidate of SE_FEED_URL_CANDIDATES) {
    try {
      const res = await fetch(candidate, {
        headers: {
          "User-Agent": "pnyxy-importer/1.0 (+https://pnyxy.com)",
          Authorization: authHeader,
        },
      });
      if (res.ok) {
        feedUrl = candidate;
        xml = await res.text();
        break;
      }
    } catch {
      // fall through to the next candidate
    }
  }
  if (!xml) {
    throw new Error(
      "None of the Standard Ebooks OPDS URLs returned 200 — credentials may be invalid or the feed moved again.",
    );
  }
  console.log(`Standard Ebooks: using feed ${feedUrl}`);
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
// **HEADS UP**: MEK's OAI-PMH URL isn't documented publicly. My
// original guess (`/oai.oai`) returned 404, and the OAI-PMH registry
// that once tracked provider baseURLs was shut down 2025-07-18.
//
// To use this adapter you need to find MEK's current OAI-PMH baseURL
// (email their librarians: info@mek.oszk.hu, or check their docs)
// and set it via:
//
//     MEK_OAI_URL=https://actual-mek-oai-url pnpm import-books --source=mek
//
// Once a working URL is known, the rest of the adapter is generic
// OAI-PMH Dublin Core harvesting — should just work.
//
// Caveats once the URL is resolved:
//   - Cover URLs aren't part of Dublin Core → cover_url is null.
//     Expect most MEK books to render without a cover image.
//   - dc:identifier is usually a page URL (e.g. https://mek.oszk.hu/00001/00001/)
//     not a direct EPUB/PDF. We set download_url to that page so the
//     user lands on MEK's own download picker.

const MEK_OAI_URL = process.env.MEK_OAI_URL;

async function importMEK(limit) {
  if (!MEK_OAI_URL) {
    console.error(
      "MEK_OAI_URL not set. The OAI-PMH baseURL for MEK isn't public\n" +
        "and my guess returned 404. Set MEK_OAI_URL to the correct\n" +
        "baseURL in .env.local and re-run, e.g.:\n" +
        "  MEK_OAI_URL=http://mek.oszk.hu/cgi-bin/xyz pnpm import-books --source=mek\n",
    );
    return 0;
  }

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

// ── Adapter: Open Library (metadata only) ──────────────────
//
// Open Library is the Internet Archive's catalog project. Their
// metadata is CC0-licensed and free to redistribute — perfect for
// seeding in-copyright titles (Harry Potter, current fiction,
// textbooks) where we *can* store title/author/cover/description
// but cannot redistribute the file itself.
//
// Search API: https://openlibrary.org/search.json?q=<query>&limit=100
//   - Returns up to 100 books per page, supports `offset` for paging
//   - Fields include: title, author_name[], cover_i (cover edition id),
//     first_publish_year, isbn[], number_of_pages_median, subject[],
//     language[]
// Covers: https://covers.openlibrary.org/b/id/<cover_i>-L.jpg
//
// Imported records have download_url = null so the reader shows the
// "metadata only" badge on them. Users can still use the book detail
// page for forum threads, notes, whiteboards, reading streaks, etc.

const OL_PAGE_SIZE = 100;

async function importOpenLibrary(limit, query) {
  if (!query) {
    console.error(
      "Open Library imports require --query=<search terms>. " +
        'Example: --query="harry potter", --query="dune", --query="philosophy"',
    );
    return 0;
  }

  let imported = 0;
  let offset = 0;

  while (imported < limit) {
    const url =
      `https://openlibrary.org/search.json?` +
      `q=${encodeURIComponent(query)}&limit=${OL_PAGE_SIZE}&offset=${offset}`;
    const res = await fetchWithRetry(url);
    const body = await res.json();
    const docs = body.docs ?? [];
    if (docs.length === 0) break;

    const candidates = docs.map(openLibraryToCatalog).filter(Boolean);
    const sourceIds = candidates.map((c) => c.source_id);
    const already = await existingSourceIds("open_library", sourceIds);
    const fresh = candidates.filter((c) => !already.has(c.source_id));
    const slice = fresh.slice(0, limit - imported);

    if (slice.length > 0) {
      await insertBatch(slice);
      imported += slice.length;
    }
    console.log(
      `Open Library: offset=${offset} imported=${imported}/${limit} (skipped ${candidates.length - fresh.length} already in catalog)`,
    );

    offset += OL_PAGE_SIZE;
    if (offset >= (body.numFound ?? 0)) break;
    await sleep(300); // polite pause between pages
  }
  return imported;
}

/** Convert an Open Library search doc into CatalogBookInsert. */
function openLibraryToCatalog(d) {
  if (!d?.key) return null;
  const title = (d.title ?? "").trim();
  const authors = Array.isArray(d.author_name)
    ? d.author_name.filter(Boolean)
    : [];
  if (!title || authors.length === 0) return null;

  // OL's work id lives at d.key (e.g. "/works/OL45883W"). Strip the
  // path prefix so our source_id matches the user-facing slug.
  const workId = String(d.key).replace(/^\/works\//, "");

  const cover_url =
    d.cover_i != null
      ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
      : null;

  const language = Array.isArray(d.language) ? d.language[0] : null;
  const isbn_13 = Array.isArray(d.isbn)
    ? d.isbn.find((i) => typeof i === "string" && i.length === 13) ?? null
    : null;
  const isbn_10 = Array.isArray(d.isbn)
    ? d.isbn.find((i) => typeof i === "string" && i.length === 10) ?? null
    : null;

  // Description is NOT in the search endpoint — pulling it would
  // require a second request per book. Skipping for now; the book
  // detail page can fetch on demand if we ever want it.
  return {
    title,
    authors,
    description: null,
    cover_url,
    isbn_13,
    isbn_10,
    page_count: d.number_of_pages_median ?? null,
    language,
    categories: Array.isArray(d.subject) ? d.subject.slice(0, 10) : [],
    source: "open_library",
    source_id: `ol:${workId}`,
    download_url: null, // metadata-only — users can't read it inline
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
    else if (SOURCE === "open-library")
      count = await importOpenLibrary(LIMIT, args.query);
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
