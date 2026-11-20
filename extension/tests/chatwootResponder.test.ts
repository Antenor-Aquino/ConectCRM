// Responder ao cliente pelo Chatwoot: modelos com as variáveis do cartão e
// envio público (e-mail), com ou sem anexos; nota no cartão.
import { describe, expect, it } from "vitest";
import { CHATWOOT_DEFAULTS, sendPublicReply } from "../src/lib/chatwoot";
import { emptyVariables, leftoverVariables, renderReply, REPLY_TEMPLATES } from "../src/lib/chatwootReplies";
import type { ChatwootData } from "../src/lib/chatwootNote";
import * as cw from "../src/db/chatwoot";
import { createPerson } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import { listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

const data: ChatwootData = {
  email_cliente: "escola.174025.financeiro@educacao.mg.gov.br",
  nome_responsavel: "Rozilene Souza",
  usuario: "escola.174025@educacao.mg.gov.br",
  email_usuario: "escola.174025@educacao.mg.gov.br",
  qtd_turmas: "24",
  plano: "Standard",
  vencimento_boleto: "20/11/2026",
  fim_vigencia: "19/11/2027",
  valor: "R$ 595,00",
  razao_social: "CAIXA ESCOLAR DR JOAO PINHEIRO",
  nome_escola: "EE DOUTOR JOAO PINHEIRO",
  cnpj: "19.360.528/0001-08",
  cep: "37490-000",
  endereco: "RUA RAIMUNDO CORREA, 55 - CENTRO - SAO GONCALO DO SAPUCAI/MG",
  email_financeiro: "escola.174025.financeiro@educacao.mg.gov.br",
};
const s = { ...CHATWOOT_DEFAULTS, token: "tok" };

describe("modelos de e-mail", () => {
  it("três modelos + texto livre, preenchidos com os dados do cartão", () => {
    expect(REPLY_TEMPLATES.map((t) => t.label)).toEqual(["Plataforma ativada + boleto e nota fiscal", "Plataforma ativada", "Envio do boleto e da nota fiscal", "Texto livre"]);
    const full = renderReply(REPLY_TEMPLATES[0]!.text, data);
    expect(full).toContain("Olá, Rozilene!");
    expect(full).toContain("A plataforma Powercubus da EE DOUTOR JOAO PINHEIRO já está ativada");
    expect(full).toContain("- Plano: Standard (24 turmas)");
    expect(full).toContain("no valor de R$ 595,00, com vencimento em 20/11/2026");
    expect(leftoverVariables(full)).toEqual([]);
    const ativ = renderReply(REPLY_TEMPLATES[1]!.text, data);
    expect(ativ).not.toMatch(/boleto|nota fiscal/i);
    const nb = renderReply(REPLY_TEMPLATES[2]!.text, data);
    expect(nb).toMatch(/boleto e a nota fiscal/);
    expect(nb).not.toMatch(/Dados de acesso/);
    for (const t of REPLY_TEMPLATES) expect(leftoverVariables(renderReply(t.text, data))).toEqual([]);
  });

  it("avisa variáveis sem valor e as escritas errado", () => {
    expect(emptyVariables(REPLY_TEMPLATES[0]!.text, { ...data, vencimento_boleto: "", plano: " " })).toEqual(["plano", "vencimento_boleto"]);
    expect(leftoverVariables(renderReply("Oi {primeiro_nome}, {nome_escol}", data))).toEqual(["nome_escol"]);
  });
});

describe("envio ao cliente", () => {
  it("sem anexo: JSON público; com anexo: multipart com private=false", async () => {
    const sent: RequestInit[] = [];
    const fn = (async (_u: string, o: RequestInit) => {
      sent.push(o);
      return { ok: true, status: 200, text: async () => "{}" } as Response;
    }) as unknown as typeof fetch;
    await sendPublicReply(s, 2316, "Olá!", [], fn);
    expect(JSON.parse(String(sent[0]!.body))).toEqual({ content: "Olá!", message_type: "outgoing", private: false });
    await sendPublicReply(s, 2316, "Segue o boleto", [{ blob: new Blob(["pdf"]), filename: "Boleto.pdf" }], fn);
    const form = sent[1]!.body as FormData;
    expect(form.get("private")).toBe("false");
    expect((form.getAll("attachments[]") as File[]).map((f) => f.name)).toEqual(["Boleto.pdf"]);
    await expect(sendPublicReply(s, 1, "  ", [], fn)).rejects.toThrow(/Escreva/);
  });

  it("nota no cartão com o texto enviado e os anexos", async () => {
    const { db, ctx: sys } = await freshDb();
    const me = createUser(db, sys, { name: "Antenor", role: "admin" });
    const ctx = { ...sys, userId: me };
    const pl = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "P" }] });
    const p = createPerson(db, ctx, { name: "Rozi", email: "r@x.com" });
    const card = createCard(db, ctx, { pipelineId: pl, title: "Licenças", personId: p });
    const link = "https://suporte.powercubus.com.br/app/accounts/1/conversations/2316";
    cw.recordChatwootTicket(db, ctx, card, { conversationId: 2316, link, data: cw.chatwootContext(db, card).data });
    cw.recordChatwootReply(db, ctx, card, { conversationId: 2316, text: "Olá, Rozi!\nPlataforma ativada.", to: "r@x.com", names: ["Boleto.pdf", "NF.pdf"] });
    expect(listNotes(db, "deal", card)[0]!.body).toBe(
      `E-mail enviado ao cliente pelo Chatwoot (para r@x.com), conversa 2316:\n${link}\n\nOlá, Rozi!\nPlataforma ativada.\n\nAnexos: Boleto.pdf, NF.pdf`,
    );
  });
});
