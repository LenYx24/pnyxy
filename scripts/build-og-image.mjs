// Regenerates the Open Graph / link-preview image at public/og-image.png
// (1200x630). Standalone tool: install the rasterizer first, it is not an
// app dependency:
//   npm i -D @resvg/resvg-js
//   node scripts/build-og-image.mjs
// Text uses a system sans (DejaVu Sans on Linux); tweak coordinates here if a
// different font metric shifts the layout.
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const W = 1200;
const H = 630;
const ACCENT = "#64FFDA";
const BG = "#0a0a0f";

// Pnyxy mark (from index.html boot splash), viewBox 0 0 1024 1024.
const mark = `
  <g transform="translate(96,182) scale(0.29)">
    <path d="M205 898V307V127H576.917C910.573 127 888.629 646 576.917 646H398.554V898H205Z" fill="${ACCENT}"/>
    <path d="M564 402H205V574L564 402Z" fill="${BG}"/>
  </g>`;

// hairline grid motif, faint
let grid = "";
for (let x = 0; x <= W; x += 60) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>`;
for (let y = 0; y <= H; y += 60) grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>`;

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="82%" cy="18%" r="70%">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.20"/>
      <stop offset="45%" stop-color="${ACCENT}" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${grid}
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="8" fill="${ACCENT}"/>
  ${mark}
  <text x="448" y="258" font-family="DejaVu Sans" font-weight="bold" font-size="118" fill="#ffffff">Pnyxy</text>
  <text x="452" y="338" font-family="DejaVu Sans" font-weight="bold" font-size="50" fill="${ACCENT}">Read Smarter</text>
  <text x="453" y="410" font-family="DejaVu Sans" font-size="33" fill="#cfd3d6">AI-assisted reading &amp; learning platform</text>
  <text x="453" y="456" font-family="DejaVu Sans" font-size="27" fill="#8b9196">PDF &amp; EPUB · annotations · flashcards · AI chat</text>
  <text x="96" y="572" font-family="DejaVu Sans" font-size="29" fill="#8b9196">pnyxy.com</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
  font: { loadSystemFonts: true },
}).render().asPng();

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, "..", "public", "og-image.png");
writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
