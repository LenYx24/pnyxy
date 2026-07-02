import { cpSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve pdfjs-dist from react-pdf's dependencies (works with pnpm strict hoisting)
const reactPdfDir = dirname(require.resolve("react-pdf/package.json"));
const localRequire = createRequire(join(reactPdfDir, "package.json"));
const pdfjsDir = dirname(localRequire.resolve("pdfjs-dist/package.json"));

const dest = join(__dirname, "..", "public", "pdf-assets");

mkdirSync(join(dest, "cmaps"), { recursive: true });
mkdirSync(join(dest, "standard_fonts"), { recursive: true });
cpSync(join(pdfjsDir, "build", "pdf.worker.min.mjs"), join(dest, "pdf.worker.min.mjs"));
cpSync(join(pdfjsDir, "cmaps"), join(dest, "cmaps"), { recursive: true });
// standard_fonts is needed when a PDF references one of the 14
// base PDF fonts (Helvetica, Times, Courier, …) without embedding
// the glyphs. Without these, pdf.js falls back to a generic
// substitute and the rendered text shifts visibly. Cheap to ship
// (~1MB of TTF), so always include them.
cpSync(join(pdfjsDir, "standard_fonts"), join(dest, "standard_fonts"), {
  recursive: true,
});
// wasm holds the WebAssembly image decoders pdf.js 5 loads on demand:
// openjpeg.wasm (JPEG2000 / JPX images) and qcms_bg.wasm (ICC colour
// management). Without these served + `wasmUrl` pointing here, any PDF
// with JPX-encoded images fails with "JpxError: OpenJPEG failed to
// initialize" and those pages render blank white.
cpSync(join(pdfjsDir, "wasm"), join(dest, "wasm"), { recursive: true });
console.log("Copied pdf.js assets to public/pdf-assets");
