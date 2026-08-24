import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The existing /public/manifest.webmanifest is the source of
      // truth for icons + branding. `injectManifest` mode would
      // require us to author a custom SW too; `generateSW` is
      // enough, workbox handles cache strategies declaratively.
      registerType: "autoUpdate",
      strategies: "generateSW",
      // We already ship a hand-rolled manifest at /manifest.webmanifest
      // with the right icon set (see public/manifest.webmanifest).
      // Disable the plugin's manifest output so it doesn't compete
      // with ours; the link in index.html keeps pointing at the
      // existing file.
      manifest: false,
      // Auto-register the SW from a virtual module imported in
      // main.tsx. `prompt` would surface an "update available"
      // toast; `autoUpdate` reloads on next nav, which is what we
      // want for a learning app where users don't notice nav
      // boundaries.
      injectRegister: "auto",
      workbox: {
        // Precache everything Vite emits, hashed assets are safe
        // to keep forever; index.html falls back to NetworkFirst
        // below so users still see updates.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2,ttf}"],
        // Bumped because pdf.worker.min.mjs is large (~1MB), the
        // default 2MB cap was rejecting it from the precache list.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // After a deploy, evict precache entries from previous
        // revisions instead of letting them pile up. Without this,
        // tabs sometimes resolved a route to a chunk filename that
        // the SW had already lost from precache and origin no
        // longer had, producing "Failed to fetch dynamically
        // imported module" errors. The companion runtime fix in
        // lazyWithRetry recovers when this still happens (e.g. on
        // a brand-new tab whose HTML predates this SW), but
        // cleaning up at the source matters more.
        cleanupOutdatedCaches: true,
        // New SW skips the "waiting" phase and activates the
        // moment it's done installing. Paired with clientsClaim
        // below so open tabs immediately use the new SW too -
        // matters because `registerType: "autoUpdate"` only
        // reloads on next navigation, and a tab sitting on the
        // same route forever would otherwise keep the old SW
        // (with old precache pointers) indefinitely.
        skipWaiting: true,
        clientsClaim: true,
        // /pdf-assets/cmaps + standard_fonts are loaded on demand
        // by pdf.js. Precache by glob would double-count; let
        // runtime caching grab them as they're requested.
        navigateFallback: "/index.html",
        // Don't intercept SPA fallback for the /api/* or supabase
        // realtime endpoints, they should 404 or stream, not
        // resolve to index.html.
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        runtimeCaching: [
          // PDF.js character maps + standard fonts, read-only,
          // versioned by Pnyxy deploy. CacheFirst is safe.
          {
            urlPattern: /\/pdf-assets\/.*$/,
            handler: "CacheFirst",
            options: {
              cacheName: "pnyxy-pdf-assets",
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 days
            },
          },
          // Book covers from Open Library / catalog sources. They
          // rarely change; cache aggressively. StaleWhileRevalidate
          // means a stale cover renders instantly while we refresh
          // it in the background.
          {
            urlPattern: ({ url }) =>
              /covers\.openlibrary\.org|books\.google\.com\/books\/content|archive\.org\/services\/img/.test(
                url.href,
              ),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "pnyxy-book-covers",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts CSS, small file, can revalidate freely.
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "pnyxy-google-fonts-css" },
          },
          // The font files themselves, versioned hashes in the URL,
          // safe to CacheFirst forever.
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "pnyxy-google-fonts-files",
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Everything else (Supabase API, Anthropic, OpenAI,
          // storage uploads, user-content fetches) is explicitly
          // NetworkOnly, we never want to serve cached user data.
          {
            urlPattern: ({ url }) =>
              /supabase\.co|anthropic\.com|openai\.com|api\.openai/.test(
                url.hostname,
              ),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        // Off in dev, SW caching during development causes more
        // confusion than it's worth. `pnpm dev` always serves
        // fresh code; SW is a production-only optimisation.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "epubjs",
    ],
  },
  define: {
    // epubjs's jszip dependency references `global` in some code paths.
    global: "globalThis",
  },
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  server: {
    // Tauri expects a fixed port; fail if that port is not available
    strictPort: true,
    // Allow Tauri's dev host for mobile development
    host: host || false,
    port: 5173,
  },
  // Produce sourcemaps for Tauri debug builds
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Bumped from the 500KB default, pdfjs + epubjs each cross
    // the threshold legitimately and there's no point splitting
    // them further. A higher limit keeps the build log readable so
    // genuine offenders still stand out.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Hand-split the heavy vendor deps so app code changes
        // (which happen most often) don't bust the cache on the
        // libraries (which change rarely). Each library lands in
        // its own long-cached chunk; the main app code is the only
        // thing that needs to re-download on a typical deploy.
        //
        // Function form is required by Rolldown (Vite 8), the
        // object form throws "manualChunks is not a function".
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Mozilla PDF.js + react-pdf wrapper, only fetched when
          // the lazy ReaderPage chunk loads.
          if (id.includes("react-pdf") || id.includes("pdfjs-dist")) {
            return "vendor-pdfjs";
          }
          // EPUB rendering, pulled in by the EPUB viewer path.
          if (id.includes("epubjs") || id.includes("jszip")) {
            return "vendor-epubjs";
          }
          // Supabase JS, used app-wide via the singleton client,
          // but isolating it keeps the auth + DB SDK in a stable
          // chunk that survives feature commits.
          if (id.includes("@supabase/")) return "vendor-supabase";
          // dnd-kit, only library + chat + roadmap pages use it.
          if (id.includes("@dnd-kit/")) return "vendor-dnd-kit";
          // React core, biggest beneficiary of long-term caching
          // since it changes only on major bumps. Match `/react/`
          // explicitly so unrelated packages with "react" in their
          // name (react-pdf, react-i18next, …) aren't pulled in.
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router)[\\/]/.test(id)
          ) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
});
