import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // Testes de tela (.tsx) usam jsdom (`// @vitest-environment jsdom` no arquivo).
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@tailadmin": resolve(__dirname, "../shared/tailadmin/src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
