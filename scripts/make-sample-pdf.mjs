// Generates the on-brand sample PDF that logged-out visitors can open to try
// the reader + AI without an account. Rendered from HTML via headless
// Chromium (page.pdf), so it is a real, nicely typeset multi-page PDF with
// clear headings the AI can cite by page. Output: public/samples/pnyxy-sample.pdf
// (served at /samples/pnyxy-sample.pdf). Run: node scripts/make-sample-pdf.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../public/samples");
const OUT = resolve(OUT_DIR, "pnyxy-sample.pdf");

const ACCENT = "#4f46e5";
const INK = "#1a1a1f";
const MUTED = "#55555f";

const section = (n, title, body) => `
  <section>
    <h2><span class="num">${n}</span>${title}</h2>
    ${body.map((p) => `<p>${p}</p>`).join("")}
  </section>`;

const html = `<!doctype html><html lang="hu"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    color: ${INK};
    line-height: 1.6;
    font-size: 12pt;
  }
  .page { padding: 22mm 20mm; }
  .page + .page { page-break-before: always; }
  .cover { display: flex; flex-direction: column; justify-content: center; min-height: 235mm; }
  .eyebrow {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    text-transform: uppercase; letter-spacing: 0.14em; font-size: 10pt;
    color: ${ACCENT}; font-weight: 600; margin: 0 0 10px;
  }
  h1 { font-size: 30pt; line-height: 1.15; margin: 0 0 14px; color: ${INK}; }
  .lead { font-size: 13.5pt; color: ${MUTED}; max-width: 130mm; }
  .cover .brand {
    margin-top: 26px; font-family: system-ui, sans-serif; font-size: 10.5pt;
    color: ${MUTED};
  }
  h2 {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 15pt; margin: 26px 0 6px; color: ${INK};
    display: flex; align-items: baseline; gap: 10px;
  }
  .num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: 6px;
    background: ${ACCENT}; color: #fff; font-size: 11pt; font-weight: 700;
    flex: none;
  }
  p { margin: 0 0 10px; }
  .intro { color: ${MUTED}; }
  .callout {
    margin-top: 22px; padding: 14px 16px; border-left: 3px solid ${ACCENT};
    background: #f4f4fb; font-family: system-ui, sans-serif; font-size: 11pt;
  }
  .callout b { color: ${ACCENT}; }
  footer {
    margin-top: 30px; font-family: system-ui, sans-serif; font-size: 9pt;
    color: #9a9aa3;
  }
</style></head><body>

  <div class="page cover">
    <p class="eyebrow">Rövid bevezető a Pnyxytől</p>
    <h1>A hatékony tanulás 5 elve</h1>
    <p class="lead">Egy pár perces összefoglaló azokról a módszerekről, amelyeket a kutatások a leghatékonyabbnak találtak. Olvasd el, majd kérdezz róla a Pnyxy AI-tól, hogy lásd, hogyan segít megérteni az anyagot.</p>
    <p class="brand">Pnyxy, az olvasó és AI-tanár egy helyen</p>
  </div>

  <div class="page">
    <p class="intro">A tanulás nem az elolvasott órák számáról szól, hanem arról, hogyan dolgozod fel az anyagot. Az alábbi öt elv egyszerű, mégis a legtöbb diák nem használja őket. Mindegyik pár perc alatt beépíthető a saját tanulásodba.</p>
    ${section(
      1,
      "Aktív felidézés",
      [
        "A felidézés (recall) sokkal többet ér, mint az újraolvasás. Ha becsukod a jegyzetet, és megpróbálod fejből elmondani, amit tanultál, az erősíti a memórianyomot. Az újraolvasás csak ismerősség-érzetet ad, tudást nem.",
        "Gyakorlati tipp: minden fejezet után tegyél fel magadnak három kérdést, és válaszolj rájuk anélkül, hogy visszalapoznál.",
      ],
    )}
    ${section(
      2,
      "Elosztott ismétlés",
      [
        "Ugyanazt az anyagot több, időben szétosztott alkalommal átnézni sokkal hatékonyabb, mint egyszer, hosszan magolni. Az agy az ismétlések közötti szünetekben szilárdítja meg a tudást.",
        "Gyakorlati tipp: egy nehéz témát nézz át ma, majd holnap, majd három nap múlva, végül egy hét múlva.",
      ],
    )}
    ${section(
      3,
      "Feynman-technika",
      [
        "Ha egy fogalmat egyszerű szavakkal, egy gyereknek is érthetően el tudsz magyarázni, akkor tényleg érted. Ahol elakadsz a magyarázatban, ott van a lyuk a tudásodban.",
        "Gyakorlati tipp: írd le a saját szavaiddal, amit tanultál, és jelöld meg, hol bizonytalanodtál el.",
      ],
    )}
  </div>

  <div class="page">
    ${section(
      4,
      "Összekapcsolás és váltogatás",
      [
        "Az új tudás akkor tapad meg, ha a régihez kötöd: keress példákat, analógiákat, ellentéteket. A különböző témák váltogatása (interleaving) tanulás közben nehezebbnek tűnik, de tartósabb tudást ad, mint egyetlen témán ülni sokáig.",
        "Gyakorlati tipp: tanulás közben kérdezd meg magadtól, hogy ez mihez hasonlít, amit már ismersz.",
      ],
    )}
    ${section(
      5,
      "Pihenés és alvás",
      [
        "Az alvás alatt rendeződik és rögzül a napközben tanult anyag. A kialvatlanul töltött éjszaka utáni magolás a leggyengébb befektetés. A rövid szünetek tanulás közben szintén javítják a megtartást.",
        "Gyakorlati tipp: zh előtt az utolsó este inkább aludj eleget, mint hogy hajnalig magolj.",
      ],
    )}
    <div class="callout">
      <b>Próbáld ki most:</b> kérdezd meg a Pnyxy AI-t erről az anyagról. Például: "Mi a különbség az aktív felidézés és az elosztott ismétlés között?" A válasz a megfelelő oldalra fog hivatkozni.
    </div>
    <footer>Pnyxy, minta-dokumentum. Ezt a fájlt nem mentjük el, csak kipróbálásra szolgál.</footer>
  </div>

</body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: false,
});
await browser.close();
console.log(`Wrote ${OUT}`);
