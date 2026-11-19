// Cliente da API do Chatwoot (porte do teste do módulo chatwoot-ativacao).
import { describe, expect, it } from "vitest";
import { CHATWOOT_DEFAULTS, ChatwootError, openActivationTicket } from "../src/lib/chatwoot";
import type { ChatwootData } from "../src/lib/chatwootNote";

const dados: ChatwootData = {
  email_cliente: "cliente@escola.com.br",
  nome_responsavel: "Nome do Responsável",
  usuario: "cliente@escola.com.br",
  qtd_turmas: "10",
  plano: "Pro",
  vencimento_boleto: "20/11/2026",
  fim_vigencia: "31/12/2027",
  valor: "R$ 1.000,00",
  razao_social: "Escola Exemplo LTDA",
  nome_escola: "Escola Exemplo",
  cnpj: "00.000.000/0001-00",
  cep: "00000-000",
  endereco: "Rua Exemplo, 123 - Cidade/UF",
  email_financeiro: "financeiro@escola.com.br",
};
const s = { ...CHATWOOT_DEFAULTS, token: "tok" };

function mock(o: { contactExists: boolean; failLabel?: boolean }) {
  const calls: string[] = [];
  const fn = (async (url: string, opts: RequestInit) => {
    const path = url.split("/accounts/1")[1]!;
    calls.push(`${opts.method} ${path}`);
    expect((opts.headers as Record<string, string>).api_access_token).toBe("tok");
    const ok = (b: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) }) as Response;
    if (path.startsWith("/contacts/search"))
      return ok({ payload: o.contactExists ? [{ id: 9, email: "CLIENTE@escola.com.br" }, { id: 3, email: "outro@x.com" }] : [{ id: 3, email: "parecido@x.com" }] });
    if (path === "/contacts") return ok({ payload: { contact: { id: 77 } } });
    if (path === "/conversations") {
      const b = JSON.parse(String(opts.body));
      expect(b).toMatchObject({ assignee_id: 6, inbox_id: 16, contact_id: o.contactExists ? 9 : 77, status: "open" });
      expect(b.message).toBeUndefined();
      expect(b.additional_attributes.mail_subject).toBe("Ativação de conta Powercubus - Escola Exemplo");
      return ok({ id: 555 });
    }
    if (path === "/conversations/555/messages") {
      const b = JSON.parse(String(opts.body));
      expect(b.private).toBe(true);
      expect(b.content).toMatch(/^\*\*Solicito ativação de conta\*\*/);
      return ok({ id: 1 });
    }
    if (path === "/conversations/555/labels") {
      if (o.failLabel) return { ok: false, status: 500, text: async () => "erro" } as Response;
      expect(JSON.parse(String(opts.body)).labels).toEqual(["conta-mg-ativacao"]);
      return ok({});
    }
    throw new Error(`rota inesperada ${path}`);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("Chatwoot: abrir ticket de ativação", () => {
  it("contato existente (e-mail sem diferença de maiúsculas): reaproveita", async () => {
    const m = mock({ contactExists: true });
    const r = await openActivationTicket(s, dados, m.fn);
    expect(r).toEqual({ conversationId: 555, link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/555", contactCreated: false });
    expect(m.calls).not.toContain("POST /contacts");
  });

  it("contato novo: cria", async () => {
    const m = mock({ contactExists: false });
    expect((await openActivationTicket(s, dados, m.fn)).contactCreated).toBe(true);
    expect(m.calls).toContain("POST /contacts");
  });

  it("falta dado ou token: nada é enviado", async () => {
    const m = mock({ contactExists: true });
    await expect(openActivationTicket(s, { ...dados, cnpj: "" }, m.fn)).rejects.toThrow(/CNPJ/);
    await expect(openActivationTicket({ ...s, token: "" }, dados, m.fn)).rejects.toThrow(/token/);
    expect(m.calls).toEqual([]);
  });

  it("falha depois de criar a conversa: o erro traz o link (não reenviar)", async () => {
    const m = mock({ contactExists: true, failLabel: true });
    const e = (await openActivationTicket(s, dados, m.fn).catch((x) => x)) as ChatwootError;
    expect(e).toBeInstanceOf(ChatwootError);
    expect(e.link).toBe("https://suporte.powercubus.com.br/app/accounts/1/conversations/555");
    expect(e.message).toMatch(/conversa 555 já foi criada/);
  });
});
