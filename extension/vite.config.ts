import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

// Copia o sql-wasm.wasm do pacote sql.js para a raiz do build (o offscreen
// busca em chrome.runtime.getURL("sql-wasm.wasm")).
function sqlWasm(): Plugin {
  return {
    name: "conectcrm-sql-wasm",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sql-wasm.wasm",
        source: readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")),
      });
    },
  };
}

// Extensão Chrome (Manifest V3): páginas servidas via chrome-extension://,
// por isso `base: "./"` (mesma configuração da gestao-financeira-extensao).
export default defineConfig({
  plugins: [react(), sqlWasm()],
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
        offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
        background: resolve(__dirname, "src/background/service-worker.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
