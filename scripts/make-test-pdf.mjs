#!/usr/bin/env node
// Dependency-free PDF fixture generator for the e2e suite.
//
// Writes tests/fixtures/long-120.pdf and tests/fixtures/short-12.pdf.
// Every page carries its page number as large Helvetica text (base-14
// font, no embedding needed) so pages are distinguishable in the reader
// and in screenshots. Every 10th page is US Letter landscape, the rest
// are A4 portrait, so the mixed-size layout math in the PDF viewer is
// exercised too.
//
// The PDF syntax is hand-written (objects, xref table, trailer). Keep it
// this way: the fixtures must stay tiny and reproducible without any
// npm dependency.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../tests/fixtures");

const A4 = [595.28, 841.89];
const LETTER_LANDSCAPE = [792, 612];

function buildPdf(pageCount) {
  // Object numbering:
  //   1 catalog, 2 pages tree, 3 font,
  //   then per page i (0-based): 4+2i page, 5+2i content stream.
  const objects = [];
  const pageObjNums = [];
  for (let i = 0; i < pageCount; i++) pageObjNums.push(4 + 2 * i);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (let i = 0; i < pageCount; i++) {
    const pageNum = i + 1;
    const landscape = pageNum % 10 === 0;
    const [w, h] = landscape ? LETTER_LANDSCAPE : A4;
    const label = String(pageNum);
    const big = 160;
    // Roughly centre the big number: Helvetica digits are ~0.556em wide.
    const textW = label.length * big * 0.556;
    const x = ((w - textW) / 2).toFixed(2);
    const y = (h / 2 - big / 3).toFixed(2);
    const content = [
      "BT",
      `/F1 ${big} Tf`,
      `${x} ${y} Td`,
      `(${label}) Tj`,
      "ET",
      "BT",
      "/F1 14 Tf",
      `36 ${(h - 50).toFixed(2)} Td`,
      `(Page ${label} of ${pageCount}${landscape ? " (landscape)" : ""}) Tj`,
      "ET",
      // a thin border so page edges are visible against a white gutter
      "0.5 w 0.6 G",
      `18 18 ${(w - 36).toFixed(2)} ${(h - 36).toFixed(2)} re S`,
    ].join("\n");
    objects[4 + 2 * i] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`;
    objects[5 + 2 * i] =
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  }

  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = Buffer.byteLength(out, "latin1");
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, "latin1");
  const size = objects.length;
  out += `xref\n0 ${size}\n`;
  out += "0000000000 65535 f \n";
  for (let n = 1; n < size; n++) {
    out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, pages] of [
  ["long-120.pdf", 120],
  ["short-12.pdf", 12],
]) {
  const buf = buildPdf(pages);
  writeFileSync(resolve(OUT_DIR, name), buf);
  console.log(`wrote tests/fixtures/${name} (${pages} pages, ${buf.length} bytes)`);
}
