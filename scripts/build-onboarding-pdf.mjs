// Builds the onboarding guide PDFs (HU + EN) into public/onboarding/.
//
// These are the "first steps" guides that get seeded into every new user's
// library on first login (see src/features/onboarding/seed-onboarding-book.ts).
// Run: `node scripts/build-onboarding-pdf.mjs` (needs Playwright chromium).
//
// The content mirrors the real in-app terminology (AI chat, Könyvtár, Terek,
// kurzus, Gyors kvíz, ...) so the guide never describes a feature that is not
// there. Keep it in sync with the app when the core flow changes.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "onboarding");

// The real Pnyxy "p" mark (from public/logo.svg), recoloured with a solid
// teal gradient and a dark notch so it reads on the matte background.
const LOGO = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M205 898V307V127H576.917C910.573 127 888.629 646 576.917 646H398.554V898H205Z" fill="url(#lg)"/>
  <path d="M564 402H205V574L564 402Z" fill="#0a0a0b"/>
  <defs><linearGradient id="lg" x1="205" y1="127" x2="820" y2="898" gradientUnits="userSpaceOnUse">
    <stop stop-color="#64ffda"/><stop offset="1" stop-color="#64fff7"/>
  </linearGradient></defs>
</svg>`;

/** One guide's worth of copy. `steps` are numbered walkthrough items. */
const CONTENT = {
  hu: {
    lang: "hu",
    fileTitle: "Pnyxy utmutato",
    kicker: "Első lépések",
    title: "Üdv a Pnyxyben!",
    lead:
      "Ez a te AI-tanulótársad: a tananyagaid, jegyzeteid, kvízeid és kérdéseid egy helyen. Ez a rövid útmutató végigvezet az első lépéseken. (Bármikor visszatérhetsz hozzá a könyvtáradból.)",
    sections: [
      {
        n: "1",
        title: "AI chat: itt kezdődik minden",
        body:
          "A chat a Pnyxy szíve. Tedd fel a kérdésed a tárgyadról, és válaszol. Dobj be egy PDF-et vagy egy linket, és abból dolgozik tovább.",
        steps: [
          "Írj be bármit a beszélgetés aljára, és küldd el Enterrel.",
          "Válts AI-modellt a mezőnél: mindegyiknek saját napi kerete van.",
          "Kezdj új beszélgetést, ha témát váltasz, így tiszta marad a kontextus.",
          "Csatolj PDF-et vagy linket, és kérdezz rá közvetlenül a tartalmára.",
        ],
      },
      {
        n: "2",
        title: "Könyvtár és olvasó",
        body:
          "A Könyvtárba töltöd fel a jegyzeteidet és a tananyagaidat. Húzd be a PDF-eket, rendezd mappákba, majd nyisd meg őket az olvasóban.",
        steps: [
          "Töltsd fel: húzd a PDF-eket a Könyvtárba, vagy válaszd ki őket.",
          "Nyisd meg a könyvet, és olvass: lapozás, nagyítás és keresés a felső sávon.",
          "Jelölj ki szöveget, és kérdezd meg róla az AI-t egy kattintással.",
          "Az oldalsó eszközökkel szótárazz, fordíts vagy chatelj az adott oldalról.",
        ],
      },
      {
        n: "3",
        title: "Tanulás: kvíz, jegyzet, tábla",
        body:
          "Minden könyvhöz tartoznak tanulási eszközök. Generálj kvízt a megértés ellenőrzésére, írj jegyzetet, vagy rajzolj a táblán.",
        steps: [
          "Gyors kvíz: készíts kérdéseket a tananyagból, és gyakorolj.",
          "Jegyzetek: írd le a lényeget a könyv melletti Jegyzetek fülön.",
          "Táblák: vizuális vázlatokhoz, levezetésekhez a Táblák fülön.",
        ],
      },
      {
        n: "4",
        title: "Terek és kurzusok",
        body:
          "A Terekben találod a tárgyaidat és a hozzájuk tartozó közös anyagokat. Ha kaptál meghívókódot, pár kattintással csatlakozol.",
        steps: [
          "Csatlakozás kóddal: add meg a kódot a Terek oldal tetején.",
          "Nyisd meg a kurzust: az előadások és gyakorlatok szekciókba rendezve várnak.",
          "Nyiss meg egy anyagot: a saját könyvtáradba másolódik, hogy jegyzetelhess benne.",
        ],
      },
    ],
    tipsTitle: "Jó, ha tudod",
    tips: [
      "Napi keret: minden AI-modellnek saját napi kerete van, ami idővel feltöltődik.",
      "Offline: a megnyitott könyvek elérhetők maradnak internet nélkül is.",
      "Egy kattintásra: a navigációból bármikor elérhető a chat, a könyvtár és a terek.",
    ],
    closing: "Jó tanulást!",
    footer: "pnyxy · Első lépések",
  },
  en: {
    lang: "en",
    fileTitle: "Pnyxy Guide",
    kicker: "Getting started",
    title: "Welcome to Pnyxy!",
    lead:
      "This is your AI study companion: your materials, notes, quizzes and questions in one place. This short guide walks you through the first steps. (You can reopen it any time from your library.)",
    sections: [
      {
        n: "1",
        title: "AI chat: where it all starts",
        body:
          "Chat is the heart of Pnyxy. Ask a question about your subject and it answers. Drop in a PDF or a link and it works from that.",
        steps: [
          "Type anything into the box at the bottom and send with Enter.",
          "Switch the AI model by the box: each one has its own daily quota.",
          "Start a new conversation when you change topic to keep the context clean.",
          "Attach a PDF or link and ask about its content directly.",
        ],
      },
      {
        n: "2",
        title: "Library and reader",
        body:
          "The Library is where you upload your notes and course materials. Drag in PDFs, organise them into folders, then open them in the reader.",
        steps: [
          "Upload: drag PDFs into the Library, or pick the files.",
          "Open a book and read: page, zoom and search live on the top bar.",
          "Select text and ask the AI about it in one click.",
          "Use the side tools to look up words, translate, or chat about the page.",
        ],
      },
      {
        n: "3",
        title: "Study: quizzes, notes, whiteboards",
        body:
          "Every book comes with study tools. Generate a quiz to check your understanding, take notes, or sketch on a whiteboard.",
        steps: [
          "Quick quiz: build questions from the material and practise.",
          "Notes: capture the key points on the book's Notes tab.",
          "Whiteboards: for visual outlines and derivations on the Whiteboards tab.",
        ],
      },
      {
        n: "4",
        title: "Spaces and courses",
        body:
          "Spaces hold your subjects and the shared materials that go with them. If you were given an invite code, you can join in a couple of clicks.",
        steps: [
          "Join with a code: enter it at the top of the Spaces page.",
          "Open the course: lectures and practicals are organised into sections.",
          "Open a material: it copies into your own library so you can annotate it.",
        ],
      },
    ],
    tipsTitle: "Good to know",
    tips: [
      "Daily quota: every AI model has its own daily allowance that refills over time.",
      "Offline: books you have opened stay available even without internet.",
      "One tap away: chat, library and spaces are always in the navigation.",
    ],
    closing: "Happy studying!",
    footer: "pnyxy · Getting started",
  },
};

function renderHtml(c) {
  const section = (s) => `
    <section class="card">
      <div class="card-head">
        <span class="num">${s.n}</span>
        <h2>${s.title}</h2>
      </div>
      <p class="card-body">${s.body}</p>
      <ol class="steps">
        ${s.steps.map((t) => `<li><span class="dot"></span><span>${t}</span></li>`).join("")}
      </ol>
    </section>`;

  return `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg: #0a0a0b;
    --panel: #141417;
    --panel-2: #1a1a1e;
    --line: rgba(255,255,255,0.08);
    --line-strong: rgba(255,255,255,0.14);
    --text: #ededf0;
    --text-2: #a6a6ad;
    --muted: #6b6b74;
    --accent: #64ffda;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 12.5px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    padding: 20mm 18mm;
    overflow: hidden;
  }
  .page + .page { page-break-before: always; }

  /* faint hairline grid + corner motif */
  .page::before {
    content: "";
    position: absolute; inset: 0;
    background-image:
      linear-gradient(var(--line) 1px, transparent 1px),
      linear-gradient(90deg, var(--line) 1px, transparent 1px);
    background-size: 28px 28px;
    opacity: 0.25;
    -webkit-mask-image: radial-gradient(120% 80% at 90% 8%, #000 0%, transparent 60%);
            mask-image: radial-gradient(120% 80% at 90% 8%, #000 0%, transparent 60%);
    pointer-events: none;
  }
  .content { position: relative; z-index: 1; }

  /* brand row */
  .brand { display: flex; align-items: center; gap: 9px; }
  .brand .mark { width: 22px; height: 22px; display: block; }
  .brand .word { font-weight: 700; font-size: 16px; letter-spacing: 0.2px; }
  .brand .word b { color: var(--accent); font-weight: 700; }

  /* cover hero */
  .hero { margin-top: 46mm; }
  .kicker {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
    color: var(--accent);
  }
  .kicker::before { content: ""; width: 22px; height: 1px; background: var(--accent); display: inline-block; }
  .hero h1 {
    margin-top: 14px;
    font-size: 42px; line-height: 1.05; font-weight: 800; letter-spacing: -0.5px;
  }
  .hero .lead {
    margin-top: 16px; max-width: 150mm;
    font-size: 13.5px; color: var(--text-2); line-height: 1.6;
  }
  .hero .rings {
    position: absolute; right: -40mm; top: 30mm;
    width: 110mm; height: 110mm; border-radius: 50%;
    border: 1px solid var(--line-strong);
    box-shadow: 0 0 0 18mm rgba(255,255,255,0.02) inset;
  }
  .hero .rings::after {
    content: ""; position: absolute; inset: 22mm; border-radius: 50%;
    border: 1px solid var(--line);
  }

  .cover-foot {
    position: absolute; left: 18mm; right: 18mm; bottom: 18mm;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 10.5px; color: var(--muted);
    border-top: 1px solid var(--line); padding-top: 10px;
  }

  /* content page */
  .section-lead {
    font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
    color: var(--muted); margin: 2mm 0 6mm;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; }
  .card {
    background: linear-gradient(180deg, var(--panel), var(--panel-2));
    border: 1px solid var(--line); border-radius: 14px;
    padding: 16px 16px 14px;
  }
  .card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .num {
    flex: none; width: 26px; height: 26px; border-radius: 8px;
    display: grid; place-items: center;
    font-weight: 700; font-size: 13px; color: var(--accent);
    background: rgba(100,255,218,0.10);
    border: 1px solid rgba(100,255,218,0.28);
  }
  .card h2 { font-size: 15px; font-weight: 700; letter-spacing: -0.2px; }
  .card-body { color: var(--text-2); font-size: 12px; margin-bottom: 10px; }
  .steps { list-style: none; display: flex; flex-direction: column; gap: 7px; }
  .steps li { display: flex; gap: 9px; align-items: flex-start; font-size: 12px; }
  .steps .dot {
    flex: none; margin-top: 6px; width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent); box-shadow: 0 0 0 3px rgba(100,255,218,0.12);
  }

  .tips {
    margin-top: 7mm;
    background: var(--panel); border: 1px solid var(--line);
    border-left: 2px solid var(--accent); border-radius: 12px; padding: 14px 16px;
  }
  .tips h3 { font-size: 13px; margin-bottom: 8px; }
  .tips ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .tips li { display: flex; gap: 9px; font-size: 11.5px; color: var(--text-2); }
  .tips li b { color: var(--text); font-weight: 600; }
  .tips .dot { flex: none; margin-top: 6px; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }

  .closing {
    margin-top: 8mm; display: flex; align-items: center; gap: 12px;
    font-size: 18px; font-weight: 700;
  }
  .closing .line { flex: 1; height: 1px; background: var(--line); }
  .closing .go { color: var(--accent); }

  .foot {
    position: absolute; left: 18mm; right: 18mm; bottom: 14mm;
    display: flex; justify-content: space-between;
    font-size: 10px; color: var(--muted);
    border-top: 1px solid var(--line); padding-top: 8px;
  }
</style>
</head>
<body>
  <!-- cover -->
  <div class="page">
    <div class="content">
      <div class="brand"><span class="mark">${LOGO}</span><span class="word">pnyxy</span></div>
      <div class="hero">
        <div class="rings"></div>
        <span class="kicker">${c.kicker}</span>
        <h1>${c.title}</h1>
        <p class="lead">${c.lead}</p>
      </div>
    </div>
    <div class="cover-foot"><span>${c.footer}</span><span>pnyxy.app</span></div>
  </div>

  <!-- walkthrough -->
  <div class="page">
    <div class="content">
      <div class="brand"><span class="mark">${LOGO}</span><span class="word">pnyxy</span></div>
      <p class="section-lead">${c.kicker}</p>
      <div class="grid">
        ${c.sections.map(section).join("")}
      </div>
      <div class="tips">
        <h3>${c.tipsTitle}</h3>
        <ul>${c.tips.map((t) => `<li><span class="dot"></span><span>${t}</span></li>`).join("")}</ul>
      </div>
      <div class="closing"><span class="go">${c.closing}</span><span class="line"></span></div>
    </div>
    <div class="foot"><span>${c.footer}</span><span>pnyxy.app</span></div>
  </div>
</body>
</html>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const key of Object.keys(CONTENT)) {
      const c = CONTENT[key];
      const page = await browser.newPage();
      await page.setContent(renderHtml(c), { waitUntil: "networkidle" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
      if (process.env.SHOT) {
        await page.setViewportSize({ width: 794, height: 1123 });
        await page.screenshot({ path: join(process.env.SHOT, `guide-${key}.png`), fullPage: true });
      }
      await page.close();
      const out = join(OUT_DIR, `pnyxy-guide-${key}.pdf`);
      await writeFile(out, pdf);
      console.log(`wrote ${out} (${pdf.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
