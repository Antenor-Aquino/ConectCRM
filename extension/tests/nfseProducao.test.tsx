// @vitest-environment jsdom
// Trava de produção (B5): emitir/cancelar nota real exige digitar PRODUÇÃO.
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmProduction } from "../src/dashboard/cards/NfseDialog";

afterEach(() => vi.restoreAllMocks());

describe("confirmProduction", () => {
  it("aceita PRODUÇÃO com ou sem acento, em qualquer caixa", () => {
    for (const v of ["PRODUÇÃO", "produção", " Producao "]) {
      vi.spyOn(window, "prompt").mockReturnValue(v);
      expect(confirmProduction("emitir")).toBe(true);
    }
  });
  it("recusa texto diferente ou cancelar", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockReturnValue("sim");
    expect(confirmProduction("emitir")).toBe(false);
    expect(alert).toHaveBeenCalledOnce();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    expect(confirmProduction("emitir")).toBe(false);
  });
});
