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
cpSync(join(pdfjsDir, "build", "pdf.worker.min.mjs"), join(dest, "pdf.worker.min.mjs"));
cpSync(join(pdfjsDir, "cmaps"), join(dest, "cmaps"), { recursive: true });
console.log("Copied pdf.js assets to public/pdf-assets");
