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
    if (method === "documents.forEntity")
      return [
        { id: "d1", name: "Contrato assinado", type_name: "Contrato", version_id: "v1", filename: "Contrato assinado.pdf", size_bytes: 1200 },
        { id: "d2", name: "Aviso de convocação", type_name: null, version_id: "v2", filename: "Convocação.pdf", size_bytes: 800 },
      ];
    return { ticketId: "t", activityId: "a" };
  }),
  DATA_CHANGED_EVENT: "x",
}));
vi.mock("../src/lib/documentFiles", () => ({
  fetchVersion: vi.fn(async (versionId: string) => ({ blob: new Blob(["pdf"], { type: "application/pdf" }), filename: versionId === "v1" ? "Contrato assinado.pdf" : "Convocação.pdf", mime: "application/pdf" })),
}));
import { ChatwootDialog } from "../src/dashboard/cards/ChatwootDialog";

const data = {
  email_cliente: "escola@educacao.mg.gov.br",
  nome_responsavel: "Rozi",
  usuario: "escola@educacao.mg.gov.br",
  email_usuario: "escola@educacao.mg.gov.br",
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
    await waitFor(() => expect(document.querySelector('[data-chatwoot-attachments] [data-chatwoot-doc="Contrato assinado"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-chatwoot-attachments] [data-chatwoot-doc="Contrato assinado"]')!);
    await act(async () => fireEvent.click(send));
    await waitFor(() => expect(document.querySelector("[data-chatwoot-done]")).not.toBeNull());
    expect(screen.getByText(/conversa 2400/)).toBeTruthy();
    expect(calls.find((c) => c.method === "cards.update")!.params).toEqual({ id: "c1", patch: { customValues: { "f-plano": "Pro" } } });
    expect(calls.find((c) => c.method === "chatwoot.record")!.params).toMatchObject({ id: "c1", conversationId: 2400, data: { plano: "Pro" }, attachments: ["Contrato assinado.pdf"] });
    const multipart = fetchMock.mock.calls.find(([, o]) => (o as RequestInit).body instanceof FormData)!;
    expect(((multipart[1] as RequestInit).body as FormData).getAll("attachments[]").map((f) => (f as File).name)).toEqual(["Contrato assinado.pdf"]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("cada conversa com a situação real; cancelar pede observação; tudo encerrado libera abrir outro", async () => {
    calls.length = 0;
    ctx.value = {
      cardTitle: "Licenças",
      pipelineId: "p",
      data: { ...data, plano: "Pro" },
      source,
      fields: {},
      missingFields: [],
      tickets: [
        { id: "a", conversation_id: 2316, link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/2316", contact_email: null, created_at: "2026-11-19T10:00:00Z", created_by_name: "Antenor", canceled_at: null, cancel_note: null },
        { id: "b", conversation_id: 2315, link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/2315", contact_email: null, created_at: "2026-11-18T10:00:00Z", created_by_name: "Antenor", canceled_at: null, cancel_note: null },
      ],
    };
    const statusOf: Record<string, string> = { "2316": "open", "2315": "resolved" };
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts: RequestInit = {}) => {
        const ok = (b: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(b), json: async () => b }) as Response;
        if (url.endsWith("/api/v1/profile")) return ok({ id: 42, name: "Antenor Aquino" });
        const m = url.match(/conversations\/(\d+)$/);
        if (m && (opts.method ?? "GET") === "GET") return ok({ status: statusOf[m[1]!], meta: { assignee: { name: "Mauricio Vieira" } } });
        posts.push(url.split("/accounts/1")[1]!);
        if (url.endsWith("/toggle_status")) statusOf["2316"] = "resolved";
        return ok({});
      }),
    );
    render(<ChatwootDialog cardId="c1" onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-chatwoot-ticket="2316"] [data-chatwoot-status="open"]')).not.toBeNull());
    expect(document.querySelector('[data-chatwoot-ticket="2315"] [data-chatwoot-status="resolved"]')!.textContent).toBe("Resolvida");
    // Só a aberta tem "Cancelar ticket"; com ela em andamento, abrir outro pede confirmação.
    expect(document.querySelectorAll("[data-chatwoot-cancel]")).toHaveLength(1);
    expect((document.querySelector("[data-chatwoot-send]") as HTMLButtonElement).disabled).toBe(true);
    // Enviar documentos à conversa em andamento.
    fireEvent.click(document.querySelector('[data-chatwoot-ticket="2316"] [data-chatwoot-attach]')!);
    fireEvent.click(document.querySelector('[data-chatwoot-attach-form] [data-chatwoot-doc="Aviso de convocação"]')!);
    await act(async () => fireEvent.click(document.querySelector("[data-chatwoot-attach-send]")!));
    await waitFor(() => expect(document.querySelector("[data-chatwoot-attach-done]")).not.toBeNull());
    expect(calls.find((c) => c.method === "chatwoot.attachRecord")!.params).toEqual({ id: "c1", conversationId: 2316, names: ["Convocação.pdf"] });
    // Responder ao cliente: modelo preenchido, troca de modelo, anexo e envio público.
    posts.length = 0;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(document.querySelector('[data-chatwoot-ticket="2316"] [data-chatwoot-reply]')!);
    const text = document.querySelector("[data-chatwoot-reply-text]") as HTMLTextAreaElement;
    expect(text.value).toContain("Olá, Rozi!");
    expect(text.value).toContain("Seguem em anexo o boleto e a nota fiscal, no valor de R$ 495,00");
    fireEvent.change(document.querySelector("[data-chatwoot-reply-template]")!, { target: { value: "ativacao" } });
    expect(text.value).not.toContain("boleto");
    fireEvent.click(document.querySelector('[data-chatwoot-reply-form] [data-chatwoot-doc="Contrato assinado"]')!);
    await act(async () => fireEvent.click(document.querySelector("[data-chatwoot-reply-send]")!));
    await waitFor(() => expect(calls.find((c) => c.method === "chatwoot.replyRecord")).toBeTruthy());
    expect(calls.find((c) => c.method === "chatwoot.replyRecord")!.params).toMatchObject({ id: "c1", conversationId: 2316, to: "escola@educacao.mg.gov.br", names: ["Contrato assinado.pdf"] });
    expect(posts).toEqual(["/conversations/2316/messages"]);
    posts.length = 0;
    fireEvent.click(document.querySelector('[data-chatwoot-ticket="2316"] [data-chatwoot-cancel]')!);
    const confirm = document.querySelector("[data-chatwoot-cancel-confirm]") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Observação do cancelamento"), { target: { value: "Cliente desistiu" } });
    await act(async () => fireEvent.click(confirm));
    await waitFor(() => expect(document.querySelector('[data-chatwoot-ticket="2316"] [data-chatwoot-status="resolved"]')).not.toBeNull());
    expect(posts).toEqual(["/conversations/2316/messages", "/conversations/2316/assignments", "/conversations/2316/toggle_status"]);
    expect(calls.find((c) => c.method === "chatwoot.cancelRecord")!.params).toEqual({ id: "c1", conversationId: 2316, note: "Cliente desistiu", by: "Antenor Aquino" });
    // Tudo encerrado: sem a caixa "mesmo assim" e o botão de abrir fica livre.
    expect(document.querySelector("[data-chatwoot-again]")).toBeNull();
    expect((document.querySelector("[data-chatwoot-send]") as HTMLButtonElement).disabled).toBe(false);
  });
});
