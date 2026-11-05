// To Do fase 5: ação "adicionar_todo" e ferramenta "listar_todo" do Copiloto.
import { describe, expect, it } from "vitest";
import { DATA_TOOLS, normalizeCard } from "../src/lib/copilot/tools";
import { buildSystemPrompt } from "../src/lib/copilot/agent";

describe("Copiloto e To Do", () => {
  it("adicionar_todo não exige cartão; usa o do contexto quando houver", () => {
    const raw = {
      titulo: "x",
      acoes: [
        { tipo: "adicionar_todo", rotulo: "Pôr no To Do", cartaoId: "", titulo: "Comprar presente", quando: null },
        { tipo: "adicionar_todo", rotulo: "Sem título", cartaoId: "", titulo: "" },
      ],
    };
    expect(normalizeCard(raw).acoes.map((a) => [a.tipo, a.titulo, a.cartaoId])).toEqual([["adicionar_todo", "Comprar presente", ""]]);
    expect(normalizeCard(raw, "card-1").acoes[0]!.cartaoId).toBe("card-1");
  });
  it("ferramenta e regra no prompt", () => {
    expect(DATA_TOOLS.some((t) => t.name === "listar_todo")).toBe(true);
    expect(buildSystemPrompt({ today: "2026-11-05", userName: "Antenor" } as never)).toMatch(/listar_todo/);
  });
});
