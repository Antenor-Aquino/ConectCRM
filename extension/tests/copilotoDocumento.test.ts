import { describe, expect, it } from "vitest";
import { cardHistory } from "../src/db/cardHistory";
import { createOrganization, getOrganization } from "../src/db/contacts";
import { getCard } from "../src/db/deals";
import { createCardFromDocument, recordOrigin, type DocCardInput } from "../src/db/docCard";
import * as docs from "../src/db/documents";
import { createPipeline } from "../src/db/pipelines";
import { createTag, listTags } from "../src/db/tags";
import { createUser } from "../src/db/users";
import { normalizeProposal } from "../src/lib/copilot/docExtract";
import { freshDb } from "./helpers";

const file = (sha: string): docs.FileRef => ({ sha256: sha.repeat(64), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 44264, filename: "PESQUISA.docx", location: "browser" });

async function setup() {
  const { db, ctx } = await freshDb();
  const actx = { ...ctx, userId: createUser(db, ctx, { name: "Antenor", role: "admin" }) };
  const pl = createPipeline(db, actx, { name: "Licitações", type: "comercial", stages: [{ name: "Pesquisa de preço" }, { name: "Proposta" }] });
  const stages = db.exec(`SELECT id FROM stage WHERE pipeline_id = '${pl}' ORDER BY position`)[0]!.values.map((v) => String(v[0]));
  return { db, actx, pl, stages };
}

describe("Copiloto: cartão a partir de documento", () => {
  it("cria organização, contato, tags, cartão e documento; histórico resumido com a origem", async () => {
    const { db, actx, pl, stages } = await setup();
    createTag(db, actx, { entity: "deal", name: "Escola" });
    const input: DocCardInput = {
      pipelineId: pl,
      stageId: stages[1]!,
      title: "Licença de sistema de grade horária — Caixa Escolar Prof. Edileia",
      description: "12 turmas matutino, 8 vespertino, 9 noturno; licença de 12 meses.",
      valueCents: null,
      organization: { create: { name: "Caixa Escolar Professora Edileia Maria Veríssimo Militão", city: "Poços de Caldas", state: "MG" } },
      person: { create: { name: "Beatriz Braz", email: "beatriz@escola.mg.gov.br" } },
      tags: ["escola", "Grade horária", "grade horária"],
      document: { name: "Pesquisa de preço — Grade de horários 2026", typeId: docs.listDocumentTypes(db).find((t) => t.name === "Proposta")!.id, file: file("a") },
      source: { fileName: "PESQUISA_DE_PRECO.docx", docType: "Pesquisa de preço", provider: "OpenAI" },
    };
    const r = createCardFromDocument(db, actx, null, input);
    const card = getCard(db, r.cardId)!;
    expect(card).toMatchObject({ title: input.title, stage_id: stages[1], person_id: r.personId, organization_id: r.organizationId, origin: "Documento (Copiloto)" });
    expect(listTags(db, "deal").map((t) => t.name).sort()).toEqual(["Escola", "Grade horária"]);
    expect(getOrganization(db, r.organizationId!)!.persons.map((p) => p.id)).toEqual([r.personId]);
    expect(docs.documentsFor(db, "deal", r.cardId, null).map((d) => d.id)).toEqual([r.documentId]);
    expect(docs.documentsFor(db, "organization", r.organizationId!, null)).toHaveLength(1);

    const h = cardHistory(db, r.cardId);
    expect(h).toHaveLength(1);
    expect(h[0]!.lines).toEqual([
      'Criado pelo Copiloto (OpenAI) a partir do documento "PESQUISA_DE_PRECO.docx" (Pesquisa de preço)',
      'Com organização Caixa Escolar Professora Edileia Maria Veríssimo Militão (nova); contato Beatriz Braz (novo); tags Escola, Grade horária (nova); documento salvo no GED como "Pesquisa de preço — Grade de horários 2026"',
    ]);
    expect(h[0]!.refs[0]).toEqual({ kind: "document", id: r.documentId });
    expect(recordOrigin(db, r.organizationId!)?.summary.file).toBe("PESQUISA_DE_PRECO.docx");
  });

  it("vincula organização existente, reaproveita o documento já no GED e desfaz tudo se algo falhar", async () => {
    const { db, actx, pl, stages } = await setup();
    const org = createOrganization(db, actx, { name: "EE Amilcar Savassi" });
    const base: DocCardInput = {
      pipelineId: pl,
      stageId: stages[0]!,
      title: "Certificado digital — EE Amilcar Savassi",
      organization: { id: org },
      person: null,
      tags: [],
      document: { name: "Pedido", typeId: null, file: file("b") },
      source: { fileName: "pedido.pdf", docType: "Pedido de compra", provider: "Claude" },
    };
    const a = createCardFromDocument(db, actx, null, base);
    const b = createCardFromDocument(db, actx, null, { ...base, title: "Outro" });
    expect(b.documentId).toBe(a.documentId);
    expect(cardHistory(db, b.cardId)[0]!.lines[1]).toContain("organização EE Amilcar Savassi (existente)");
    const before = db.exec("SELECT COUNT(*) FROM organization")[0]!.values[0]![0];
    expect(() =>
      createCardFromDocument(db, actx, null, { ...base, organization: { create: { name: "Nova Escola" } }, stageId: "etapa-inexistente" }),
    ).toThrow();
    expect(db.exec("SELECT COUNT(*) FROM organization")[0]!.values[0]![0]).toBe(before);
  });
});

describe("Copiloto: validação do que a IA devolveu", () => {
  const structure = { funis: [{ id: "f1", nome: "Licitações", tipo: "comercial", etapas: [{ id: "e1", nome: "Pesquisa" }, { id: "e2", nome: "Proposta" }] }] };
  const ged = ["Proposta", "Contrato", "Outros"];
  it("descarta CNPJ/e-mail inválidos, ids que não existem e valor em branco", () => {
    const p = normalizeProposal(
      {
        tipoDocumento: "Pesquisa de preço",
        resumo: "Licença para 29 turmas.",
        organizacao: { nome: "Caixa Escolar X", razaoSocial: null, cnpj: "11.111.111/1111-11", email: "sem-arroba", telefone: "123", endereco: null, cidade: "Poços de Caldas", uf: "mg" },
        contato: { nome: null, cargo: null, email: null, telefone: null },
        cartao: { titulo: "", valor: 0, prazo: "20/10/2026" },
        tags: ["Escola", "escola", "Licitação"],
        destino: { funilId: "f1", etapaId: "nao-existe", motivo: "pesquisa de preço" },
        documento: { nome: "Pesquisa", tipoGed: "proposta" },
        evidencias: [{ campo: "organizacao.nome", trecho: "CAIXA ESCOLAR X" }],
        avisos: ["Sem CNPJ do cliente"],
      },
      structure,
      ged,
      "PESQUISA.docx",
    );
    expect(p.organizacao).toMatchObject({ nome: "Caixa Escolar X", cnpj: "", email: "", telefone: "", uf: "MG" });
    expect(p.contato).toBeNull();
    expect(p.cartao).toEqual({ titulo: "Pesquisa de preço — Caixa Escolar X", valor: null, prazo: "" });
    expect(p.tags).toEqual(["Escola", "Licitação"]);
    expect(p.destino).toEqual({ funilId: "f1", etapaId: "e1", motivo: "pesquisa de preço" });
    expect(p.documento.tipoGed).toBe("Proposta");
    expect(p.avisos).toEqual(["Sem CNPJ do cliente", "CNPJ 11.111.111/1111-11 ignorado (dígitos inválidos).", "E-mail da organização ignorado (inválido): sem-arroba"]);
    expect(normalizeProposal({ destino: { funilId: "xx", etapaId: "e1" } }, structure, ged, "a.pdf").destino).toBeNull();
  });
});
