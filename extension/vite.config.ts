import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Extensão Chrome (Manifest V3): páginas servidas via chrome-extension://,
// por isso `base: "./"` (mesma configuração da gestao-financeira-extensao).
export default defineConfig({
  plugins: [react()],
  // Worker do banco (src/offscreen/dbWorker.ts) como módulo ES; o sqlite3.wasm
  // do SQLite oficial é emitido junto (new URL(..., import.meta.url)).
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  base: "./",
  resolve: {
    alias: {
      "@tailadmin": resolve(__dirname, "../shared/tailadmin/src"),
    },
  },
  css: {
    postcss: resolve(__dirname, "postcss.config.js"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, "src/dashboard/dashboard.html"),
        popup: resolve(__dirname, "src/popup/popup.html"),
        alert: resolve(__dirname, "src/alert/alert.html"),
        offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
        background: resolve(__dirname, "src/background/service-worker.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
