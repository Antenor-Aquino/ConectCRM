// Gera um CSS Tailwind já compilado (utilitários + tokens) pras páginas
// estáticas (guia/, knowledge-base/) que não passam pelo Vite - elas só
// linkam o arquivo gerado, sem build step próprio. Escaneia o HTML/JS
// dessas páginas via @source explícito no source.css temporário abaixo.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "../../extension/public/assets");
const outFile = resolve(outDir, "tailadmin-base.css");

const source = `
@import "./src/index.css";
@source "../../extension/public/guia";
@source "../../extension/public/knowledge-base";
`;

async function build() {
  mkdirSync(outDir, { recursive: true });
  const result = await postcss([tailwindcss()]).process(source, {
    from: resolve(__dirname, "tailwind-static-entry.css"),
    to: outFile,
  });
  writeFileSync(outFile, result.css);
  console.log(`Wrote ${outFile} (${Buffer.byteLength(result.css)} bytes)`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
