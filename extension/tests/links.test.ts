import { describe, expect, it } from "vitest";
import { splitLinks } from "../src/dashboard/ui/LinkedText";
import { noteText } from "../src/db/notes";

describe("links clicáveis", () => {
  it("separa http(s), www e e-mail; pontuação final fica fora do link", () => {
    expect(splitLinks("Acompanhar: https://atendimento.perseus.com.br/tickets/402287.")).toEqual([
      { text: "Acompanhar: " },
      { text: "https://atendimento.perseus.com.br/tickets/402287", href: "https://atendimento.perseus.com.br/tickets/402287" },
      { text: "." },
    ]);
    expect(splitLinks("site www.conect.com.br, e-mail ana@x.com.br")).toEqual([
      { text: "site " },
      { text: "www.conect.com.br", href: "https://www.conect.com.br" },
      { text: ", e-mail " },
      { text: "ana@x.com.br", href: "mailto:ana@x.com.br" },
    ]);
    expect(splitLinks("(veja https://pt.wikipedia.org/wiki/CRM_(software))")[1]).toEqual({
      text: "https://pt.wikipedia.org/wiki/CRM_(software)",
      href: "https://pt.wikipedia.org/wiki/CRM_(software)",
    });
    expect(splitLinks("sem link")).toEqual([{ text: "sem link" }]);
  });

  it("texto da nota sem os marcadores de imagem", () => {
    expect(noteText("Print da tela:\n[imagem:abc-123]\nok")).toBe("Print da tela:\n[imagem]\nok");
  });
});
