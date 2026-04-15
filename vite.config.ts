import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
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
});
