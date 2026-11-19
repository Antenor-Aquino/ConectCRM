// @vitest-environment jsdom
// Janela "Ativação no Chatwoot": dados do cartão, aviso de ticket anterior,
// salvar campos no cartão e abrir o ticket (API simulada).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { method: string; params: Record<string, unknown> }[]);
const ctx = vi.hoisted(() => ({
  value: null as unknown,
}));
vi.mock("../src/rpc/client", () => ({
  call: vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === "chatwoot.context") return ctx.value;
    return { ticketId: "t", activityId: "a" };
  }),
  DATA_CHANGED_EVENT: "x",
}));
import { ChatwootDialog } from "../src/dashboard/cards/ChatwootDialog";

const data = {
  email_cliente: "escola@educacao.mg.gov.br",
  nome_responsavel: "Rozi",
  usuario: "escola@educacao.mg.gov.br",
  qtd_turmas: "10",
  plano: "",
  vencimento_boleto: "20/11/2026",
  fim_vigencia: "31/12/2027",
  valor: "R$ 495,00",
  razao_social: "CAIXA ESCOLAR",
  nome_escola: "EE Doutor João Pinheiro",
  cnpj: "19.929.587/0001-46",
  cep: "38067-230",
  endereco: "Rua A, 10 - Uberaba/MG",
  email_financeiro: "fin@escola.com.br",
};
const source = Object.fromEntries(Object.keys(data).map((k) => [k, "cartão"]));
const store: Record<string, unknown> = { "conectcrm-chatwoot": { token: "tok", pipelineIds: [] } };
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: { get: async (k: string) => ({ [k]: store[k] }), set: async () => {} } },
  permissions: { request: async () => true },
};

afterEach(cleanup);

describe("Ativação no Chatwoot (tela)", () => {
  it("mostra os dados, pede o que falta, avisa o ticket anterior e abre o ticket", async () => {
    ctx.value = {
      cardTitle: "Licenças",
      pipelineId: "p",
      data,
      source,
      fields: { plano: { id: "f-plano", type: "text" }, qtd_turmas: { id: "f-qtd", type: "number" } },
      missingFields: [],
      tickets: [{ id: "x", conversation_id: 2315, link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/2315", contact_email: null, created_at: "2026-11-19T10:00:00Z", created_by_name: "Antenor" }],
    };
    const fetchMock = vi.fn(async (url: string, opts: RequestInit) => {
      const path = url.split("/accounts/1")[1]!;
      const ok = (b: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) }) as Response;
      if (path.startsWith("/contacts/search")) return ok({ payload: [{ id: 9, email: data.email_cliente }] });
      if (path === "/conversations") return ok({ id: 2400 });
      void opts;
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<ChatwootDialog cardId="c1" onClose={() => {}} onChanged={onChanged} />);
    await waitFor(() => expect(document.querySelector('[data-chatwoot-field="nome_escola"]')).not.toBeNull());
    expect((document.querySelector('[data-chatwoot-field="razao_social"]') as HTMLInputElement).value).toBe("CAIXA ESCOLAR");
    expect(document.querySelector("[data-chatwoot-missing]")!.textContent).toContain("Plano");
    const send = document.querySelector("[data-chatwoot-send]") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(document.querySelector('[data-chatwoot-field="plano"]')!, { target: { value: "Pro" } });
    // Ticket anterior: precisa confirmar.
    expect(document.querySelector("[data-chatwoot-previous]")!.textContent).toContain("Conversa 2315");
    expect(send.disabled).toBe(true);
    fireEvent.click(document.querySelector("[data-chatwoot-again]")!);
    expect(send.disabled).toBe(false);
    expect(document.querySelector("[data-chatwoot-preview]")!.textContent).toContain("Plano: Pro");
    await act(async () => fireEvent.click(send));
    await waitFor(() => expect(document.querySelector("[data-chatwoot-done]")).not.toBeNull());
    expect(screen.getByText(/conversa 2400/)).toBeTruthy();
    expect(calls.find((c) => c.method === "cards.update")!.params).toEqual({ id: "c1", patch: { customValues: { "f-plano": "Pro" } } });
    expect(calls.find((c) => c.method === "chatwoot.record")!.params).toMatchObject({ id: "c1", conversationId: 2400, data: { plano: "Pro" } });
    expect(onChanged).toHaveBeenCalled();
  });
});
