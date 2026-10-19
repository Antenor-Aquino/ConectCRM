import { describe, expect, it } from "vitest";
import { createActivity } from "../src/db/activities";
import { bootstrap } from "../src/db/bootstrap";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCustomField } from "../src/db/customFields";
import { createCard, updateCard } from "../src/db/deals";
import * as docs from "../src/db/documents";
import { MIGRATIONS, runMigrations } from "../src/db/migrate";
import { createPipeline, listPipelines } from "../src/db/pipelines";
import { createTag } from "../src/db/tags";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb, emptyDb } from "./helpers";
import type { DatabaseSync } from "../src/db/sql";

let n = 0;
/** Arquivo fictício (o conteúdo fica fora do banco; aqui só o registro). */
const file = (filename: string, mime = "application/pdf", extra: Partial<docs.FileRef> = {}): docs.FileRef => ({
  sha256: (++n).toString(16).padStart(64, "0"),
  mime,
  size: 100,
  filename,
  location: "browser",
  ...extra,
});

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const admin = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ana = createUser(db, sys, { name: "Ana", role: "vendedor" });
  const bruno = createUser(db, sys, { name: "Bruno", role: "vendedor" });
  const ctx = { ...sys, userId: admin };
  const pid = createPipeline(db, ctx, { name: "Negócios", type: "comercial", stages: [{ name: "Prospect" }] });
  const org = createOrganization(db, ctx, { name: "Posto 5 Irmãos", cnpj: "11222333000181" });
  const regina = createPerson(db, ctx, { name: "Regina Conceição", email: "regina@exemplo.com", organizationIds: [org] });
  const deal = createCard(db, ctx, { pipelineId: pid, title: "Matrícula 2027", personId: regina, organizationId: org, ownerId: ana });
  const task = createActivity(db, ctx, { title: "Conferir documentos", dealId: deal, ownerId: ana });
  const types = docs.listDocumentTypes(db);
  const type = (name: string) => types.find((t) => t.name === name)!.id;
  return { db, ctx, sys, admin, ana, bruno, pid, org, regina, deal, task, type };
}

const as = (ctx: { workspaceId: string }, userId: string) => ({ ...ctx, userId });

describe("GED: vínculos automáticos pela tela", () => {
  it("tarefa → tarefa, cartão, contato e organização; cartão → cartão, contato e organização; contato → contato e organizações", async () => {
    const { db, deal, task, regina, org } = await setup();
    const pick = (l: docs.DocLinkRef[]) => l.map((x) => `${x.type}:${x.auto ? "auto" : "tela"}`);
    expect(pick(docs.contextLinks(db, "activity", task))).toEqual(["activity:tela", "deal:auto", "person:auto", "organization:auto"]);
    expect(docs.contextLinks(db, "activity", task).map((l) => l.id)).toEqual([task, deal, regina, org]);
    expect(pick(docs.contextLinks(db, "deal", deal))).toEqual(["deal:tela", "person:auto", "organization:auto"]);
    expect(pick(docs.contextLinks(db, "person", regina))).toEqual(["person:tela", "organization:auto"]);
    expect(pick(docs.contextLinks(db, "organization", org))).toEqual(["organization:tela"]);
    const labels = methods["documents.contextLinks"](db, { workspaceId: "", userId: null } as never, { type: "activity", id: task });
    expect(labels.map((l) => l.label)).toEqual(["Conferir documentos", "Matrícula 2027", "Regina Conceição", "Posto 5 Irmãos"]);
    expect(labels[1]!.sub).toBe("Negócios");
  });

  it("o comprovante anexado na tarefa aparece na tarefa, no cartão, no contato e na organização", async () => {
    const { db, ctx, deal, task, regina, org, type } = await setup();
    const id = docs.createDocument(db, ctx, {
      name: "Comprovante de endereço - Regina",
      typeId: type("Comprovante de endereço"),
      links: docs.contextLinks(db, "activity", task),
      file: file("comprovante.pdf"),
    });
    for (const [t, eid] of [
      ["activity", task],
      ["deal", deal],
      ["person", regina],
      ["organization", org],
    ] as const) {
      expect(
        docs.documentsFor(db, t, eid).map((d) => d.id),
        t,
      ).toEqual([id]);
    }
    // "Remover deste cadastro" só tira daquele cadastro.
    docs.removeDocumentLink(db, ctx, id, "organization", org);
    expect(docs.documentsFor(db, "organization", org)).toEqual([]);
    expect(docs.documentsFor(db, "person", regina)).toHaveLength(1);
    // Lixeira tira de todos; restaurar devolve.
    docs.trashDocument(db, ctx, id);
    expect(docs.documentsFor(db, "deal", deal)).toEqual([]);
    expect(docs.listDocuments(db, { trash: true }).items.map((d) => d.id)).toEqual([id]);
    docs.restoreDocument(db, ctx, id);
    expect(docs.documentsFor(db, "deal", deal)).toHaveLength(1);
  });

  it("exige nome e classificação; vínculo a registro inexistente é recusado", async () => {
    const { db, ctx, type } = await setup();
    expect(() => docs.createDocument(db, ctx, { name: " ", typeId: type("Contrato"), file: file("a.pdf") })).toThrow(/Nome/);
    expect(() => docs.createDocument(db, ctx, { name: "X", typeId: null, file: file("a.pdf") })).toThrow(/classificação/);
    expect(() =>
      docs.createDocument(db, ctx, { name: "X", typeId: type("Contrato"), links: [{ type: "deal", id: "nao-existe" }], file: file("a.pdf") }),
    ).toThrow(/não encontrado/);
    expect(() => docs.createDocument(db, ctx, { name: "X", typeId: type("Contrato"), file: { ...file("a.pdf"), sha256: "xyz" } })).toThrow(/SHA-256/);
    expect(() => docs.createDocument(db, ctx, { name: "X", typeId: type("Contrato"), file: { ...file("a.pdf"), size: 26 * 1024 * 1024 } })).toThrow(/25 MB/);
  });
});

describe("GED: busca livre e filtros", () => {
  async function corpus() {
    const s = await setup();
    const { db, ctx, deal, regina, org, type } = s;
    const kw = createTag(db, ctx, { entity: "document", name: "Matrícula" });
    const comp = docs.createDocument(db, ctx, {
      name: "Comprovante de endereço",
      typeId: type("Comprovante de endereço"),
      validUntil: "2026-10-20",
      links: [{ type: "person", id: regina }],
      file: file("conta-de-luz.pdf", "application/pdf", { text: "COPEL Companhia Paranaense de Energia — Fatura" }),
    });
    const contrato = docs.createDocument(db, ctx, {
      name: "Contrato assinado",
      typeId: type("Contrato"),
      description: "Versão final com cláusula de reajuste",
      docDate: "2026-09-15",
      tagIds: [kw],
      links: [{ type: "deal", id: deal }],
      file: file("contrato.pdf"),
    });
    const foto = docs.createDocument(db, ctx, {
      name: "Fachada do posto",
      typeId: type("Foto/imagem"),
      links: [{ type: "organization", id: org }],
      file: file("fachada.jpg", "image/jpeg"),
    });
    const solto = docs.createDocument(db, ctx, {
      name: "Planilha 100% ok",
      typeId: type("Outros"),
      validUntil: "2027-06-01",
      file: file("dados.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    });
    return { ...s, comp, contrato, foto, solto, kw };
  }
  const ids = (r: { items: { id: string }[] }) => r.items.map((d) => d.id).sort();

  it("sem acento, maiúsculas, pedaço de palavra e em qualquer ordem, em qualquer campo", async () => {
    const { db, comp, contrato, foto, solto } = await corpus();
    const q = (search: string) => ids(docs.listDocuments(db, { search }));
    expect(q("comp ender")).toEqual([comp]);
    expect(q("ENDER comp")).toEqual([comp]);
    expect(q("endereco")).toEqual([comp]); // nome com acento
    expect(q("regina conceicao")).toEqual([comp]); // contato vinculado
    expect(q("regina@exemplo")).toEqual([comp]);
    expect(q("paranaense")).toEqual([comp]); // texto de dentro do PDF
    expect(q("luz")).toEqual([comp]); // nome do arquivo
    expect(q("clausula reaj")).toEqual([contrato]); // descrição
    expect(q("matricula")).toEqual([contrato].sort()); // palavra-chave e cartão
    expect(q("negocios")).toEqual([contrato]); // nome do funil
    expect(q("15/09/2026")).toEqual([contrato]); // data do documento
    expect(q("irmaos")).toEqual([foto]); // organização
    expect(q("11222333")).toEqual([foto]); // CNPJ da organização
    expect(q("foto/imagem")).toEqual([foto]); // classificação
    expect(q("antenor")).toHaveLength(4); // quem enviou
    expect(q("100%")).toEqual([solto]); // caracteres especiais não viram curinga
    expect(q("comprovante contrato")).toEqual([]);
  });

  it("filtros por classificação, funil, cartão, contato, organização, formato, validade, sem vínculo e palavra-chave", async () => {
    const { db, pid, deal, regina, org, type, comp, contrato, foto, solto, kw } = await corpus();
    const f = (filter: docs.DocumentFilter) => ids(docs.listDocuments(db, { today: "2026-10-17", ...filter }));
    expect(f({ typeId: type("Contrato") })).toEqual([contrato]);
    expect(f({ pipelineId: pid })).toEqual([contrato]);
    expect(f({ dealId: deal })).toEqual([contrato]);
    expect(f({ personId: regina })).toEqual([comp]);
    expect(f({ organizationId: org })).toEqual([foto]);
    expect(f({ format: "image" })).toEqual([foto]);
    expect(f({ format: "pdf" })).toEqual([comp, contrato].sort());
    expect(f({ format: "sheet" })).toEqual([solto]);
    expect(f({ validity: "soon" })).toEqual([comp]);
    expect(f({ validity: "expired", today: "2026-10-21" })).toEqual([comp]);
    expect(f({ validity: "valid" })).toEqual([solto]);
    expect(f({ validity: "none" })).toEqual([contrato, foto].sort());
    expect(f({ unlinked: true })).toEqual([solto]);
    expect(f({ tagIds: [kw] })).toEqual([contrato]);
    const byName = docs.listDocuments(db, { sort: "name", dir: "asc" }).items.map((d) => d.name);
    expect(byName).toEqual(["Comprovante de endereço", "Contrato assinado", "Fachada do posto", "Planilha 100% ok"]);
    const page = docs.listDocuments(db, { sort: "name", dir: "asc", limit: 2, offset: 2 });
    expect(page.total).toBe(4);
    expect(page.items.map((d) => d.name)).toEqual(["Fachada do posto", "Planilha 100% ok"]);
    const st = docs.documentStats(db, null, "2026-10-17");
    expect(st).toMatchObject({ total: 4, soon: 1, expired: 0, unclassified: 0, unlinked: 1, trash: 0, bytes: 400 });
    expect(docs.expiringDocuments(db, 7, null, "2026-10-17").map((d) => d.id)).toEqual([comp]);
  });
});

describe("GED: permissões e documento restrito", () => {
  it("vendedor vê documentos dos seus cartões, de contatos e sem vínculo; restrito só para quem enviou, admin e responsável do cartão", async () => {
    const { db, ctx, sys, ana, bruno, pid, deal, regina, type } = await setup();
    const dealBruno = createCard(db, ctx, { pipelineId: pid, title: "Do Bruno", ownerId: bruno });
    const t = type("Contrato");
    const daAna = docs.createDocument(db, ctx, { name: "Do cartão da Ana", typeId: t, links: [{ type: "deal", id: deal }], file: file("1.pdf") });
    const doBruno = docs.createDocument(db, ctx, { name: "Do cartão do Bruno", typeId: t, links: [{ type: "deal", id: dealBruno }], file: file("2.pdf") });
    const contato = docs.createDocument(db, ctx, { name: "Do contato", typeId: t, links: [{ type: "person", id: regina }], file: file("3.pdf") });
    const solto = docs.createDocument(db, ctx, { name: "Sem vínculo", typeId: t, file: file("4.pdf") });
    const rg = docs.createDocument(db, ctx, {
      name: "RG da Regina",
      typeId: t,
      restricted: true,
      links: [
        { type: "person", id: regina },
        { type: "deal", id: deal },
      ],
      file: file("5.pdf"),
    });
    const rgBruno = docs.createDocument(db, as(sys, bruno), {
      name: "CPF enviado pelo Bruno",
      typeId: t,
      restricted: true,
      links: [{ type: "person", id: regina }],
      file: file("6.pdf"),
    });
    const seen = (userId: string) =>
      methods["documents.list"](db, as(sys, userId), {})
        .items.map((d) => d.name)
        .sort();
    expect(seen(ana)).toEqual(["Do cartão da Ana", "Do contato", "RG da Regina", "Sem vínculo"].sort());
    expect(seen(bruno)).toEqual(["CPF enviado pelo Bruno", "Do cartão do Bruno", "Do contato", "Sem vínculo"].sort());
    expect(seen(ctx.userId!)).toHaveLength(6);
    // A aba do contato também respeita o restrito.
    expect(
      methods["documents.forEntity"](db, as(sys, bruno), { type: "person", id: regina })
        .map((d) => d.id)
        .sort(),
    ).toEqual([contato, rgBruno].sort());
    expect(() => methods["documents.get"](db, as(sys, bruno), { id: daAna })).toThrow(/permissão/);
    expect(() => methods["documents.get"](db, as(sys, ana), { id: doBruno })).toThrow(/permissão/);
    expect(methods["documents.get"](db, as(sys, ana), { id: rg })!.restricted).toBe(1);
    // Vendedor não exclui nem tira o restrito de documento que não enviou.
    expect(() => methods["documents.trash"](db, as(sys, ana), { ids: [contato] })).toThrow(/Só quem enviou/);
    expect(() => methods["documents.update"](db, as(sys, ana), { id: rg, patch: { restricted: false } })).toThrow(/Só quem enviou/);
    methods["documents.update"](db, as(sys, ana), { id: rg, patch: { name: "RG (frente e verso)" } });
    methods["documents.trash"](db, as(sys, bruno), { ids: [rgBruno] });
    // Vincular exige acesso ao cadastro; a busca de vínculos também respeita.
    expect(() => methods["documents.addLinks"](db, as(sys, ana), { ids: [solto], links: [{ type: "deal", id: dealBruno }] })).toThrow(/permissão/);
    expect(methods["documents.linkTargets"](db, as(sys, ana), { q: "bruno" })).toEqual([]);
    expect(methods["documents.linkTargets"](db, as(sys, ana), { q: "matric" }).map((l) => l.label)).toEqual(["Matrícula 2027"]);
    expect(() => methods["documents.purge"](db, as(sys, ana), { ids: [rgBruno] })).toThrow(/permissão/);
  });
});

describe("GED: versões, lixeira, arquivos repetidos e auditoria", () => {
  it("nova versão guarda a anterior; restaurar cria outra versão; trilha registra tudo, inclusive visualizar e baixar", async () => {
    const { db, ctx, deal, type } = await setup();
    const id = docs.createDocument(db, ctx, { name: "Contrato", typeId: type("Contrato"), links: [{ type: "deal", id: deal }], file: file("contrato-v1.pdf") });
    const v1 = docs.getDocument(db, id)!.version_id;
    docs.addDocumentVersion(db, ctx, id, file("contrato-v2.pdf"));
    expect(docs.getDocument(db, id)).toMatchObject({ filename: "contrato-v2.pdf", version_number: 2, versions: 2 });
    docs.restoreDocumentVersion(db, ctx, id, v1);
    const d = docs.getDocument(db, id)!;
    expect(d).toMatchObject({ filename: "contrato-v1.pdf", version_number: 3 });
    expect(d.versionList.map((v) => v.number)).toEqual([3, 2, 1]);
    docs.updateDocument(db, ctx, id, { validUntil: "2027-01-31", typeId: type("Proposta") });
    methods["documents.file"](db, ctx, { versionId: d.version_id, action: "download" });
    methods["documents.file"](db, ctx, { versionId: d.version_id, action: "view" });
    const audit = docs.documentAudit(db, id).map((a) => a.text);
    expect(audit).toEqual(
      expect.arrayContaining([
        'Enviou o documento "Contrato"',
        "Versão 1: contrato-v1.pdf",
        "Versão 2: contrato-v2.pdf",
        "Versão 3: contrato-v1.pdf",
        "Vinculou ao cartão Matrícula 2027",
        "Validade: vazio → 31/01/2027",
        "Classificação: Contrato → Proposta",
        "Baixou contrato-v1.pdf",
        "Visualizou",
      ]),
    );
    expect(docs.documentAudit(db, id)[0]!.user_name).toBe("Antenor");
  });

  it("mesmo arquivo em dois documentos ocupa um só; exclusão definitiva só libera o arquivo sem uso", async () => {
    const { db, ctx, type } = await setup();
    const same = file("rg.pdf");
    const a = docs.createDocument(db, ctx, { name: "RG", typeId: type("Documento de identificação"), file: same });
    const b = docs.createDocument(db, ctx, { name: "RG (cópia)", typeId: type("Documento de identificação"), file: same });
    expect(
      docs
        .documentsBySha(db, same.sha256)
        .map((d) => d.name)
        .sort(),
    ).toEqual(["RG", "RG (cópia)"]);
    expect(docs.documentStats(db).bytes).toBe(100);
    docs.trashDocument(db, ctx, a);
    expect(docs.purgeDocuments(db, ctx, [a])).toEqual([]);
    expect(() => docs.restoreDocument(db, ctx, a)).toThrow(/definitivamente/);
    docs.trashDocument(db, ctx, b);
    expect(docs.purgeDocuments(db, ctx, [b]).map((o) => o.sha256)).toEqual([same.sha256]);
    expect(docs.blobBySha(db, same.sha256)).toBeUndefined();
    // Lixeira expira em 30 dias.
    const c = docs.createDocument(db, ctx, { name: "Velho", typeId: type("Outros"), file: file("v.pdf") });
    docs.trashDocument(db, ctx, c);
    expect(docs.expiredTrash(db, 30)).toEqual([]);
    expect(docs.expiredTrash(db, 30, new Date(Date.now() + 31 * 86400_000))).toEqual([c]);
  });

  it("texto do PDF: fica pendente quando não lido e é gravado normalizado", async () => {
    const { db, ctx, type } = await setup();
    const id = docs.createDocument(db, ctx, { name: "Edital", typeId: type("Outros"), file: { ...file("edital.pdf"), text: undefined } });
    const v = docs.pendingTextVersions(db);
    expect(v.map((x) => x.document_id)).toEqual([id]);
    docs.setVersionText(db, ctx, v[0]!.id, "Edital de CONVOCAÇÃO");
    expect(docs.pendingTextVersions(db)).toEqual([]);
    expect(docs.listDocuments(db, { search: "convocacao" }).items.map((d) => d.id)).toEqual([id]);
  });

  it("histórico do cartão mostra vincular e desvincular documento", async () => {
    const { db, ctx, deal, type } = await setup();
    const id = docs.createDocument(db, ctx, { name: "Proposta assinada", typeId: type("Proposta"), links: [{ type: "deal", id: deal }], file: file("p.pdf") });
    db.run("UPDATE change_log SET at = strftime('%Y-%m-%dT%H:%M:%fZ', at, '-1 minute')");
    docs.removeDocumentLink(db, ctx, id, "deal", deal);
    const lines = methods["cards.history"](db, ctx, { id: deal }).flatMap((e) => e.lines);
    expect(lines).toEqual(expect.arrayContaining(["Vinculou o documento Proposta assinada", "Desvinculou o documento Proposta assinada"]));
  });
});

describe("GED: tipos de documento e campo personalizado", () => {
  it("tipos padrão (inclusive em base antiga), validade sugerida e exclusão deixa os documentos não classificados", async () => {
    const { db, ctx, type } = await setup();
    const names = docs.listDocumentTypes(db).map((t) => t.name);
    expect(names).toEqual(docs.DEFAULT_DOCUMENT_TYPES.map((t) => t.name));
    expect(docs.listDocumentTypes(db).find((t) => t.name === "Comprovante de endereço")!.valid_days).toBe(90);
    expect(() => docs.createDocumentType(db, ctx, { name: "contrato" })).toThrow(/Já existe/);
    expect(() => docs.createDocumentType(db, ctx, { name: "Laudo", validDays: 0 })).toThrow(/1 a 3650/);
    const laudo = docs.createDocumentType(db, ctx, { name: "Laudo", validDays: 180 });
    const id = docs.createDocument(db, ctx, { name: "Laudo técnico", typeId: laudo, file: file("l.pdf") });
    docs.deleteDocumentType(db, ctx, laudo);
    expect(docs.getDocument(db, id)!.type_id).toBeNull();
    expect(docs.listDocuments(db, { typeId: "none" }).items.map((d) => d.id)).toEqual([id]);
    expect(docs.listDocuments(db, { search: "nao classificado" }).items.map((d) => d.id)).toEqual([id]);
    // Vendedor cria classificação nova ao digitar; editar/excluir continua com gestores.
    const vera = as(ctx, createUser(db, ctx, { name: "Vera", role: "vendedor" }));
    const nova = methods["documentTypes.create"](db, vera, { name: "Nota de débito" });
    expect(() => methods["documentTypes.update"](db, vera, { id: nova, patch: { name: "Y" } })).toThrow(/permissão/);
    void type;
  });

  it("campo personalizado do tipo Documento aponta para um documento existente", async () => {
    const { db, ctx, regina, type } = await setup();
    const f = createCustomField(db, ctx, { entity: "person", name: "RG", fieldType: "document" });
    const id = docs.createDocument(db, ctx, { name: "RG Regina", typeId: type("Documento de identificação"), file: file("rg.pdf") });
    const { updatePerson, getPerson } = await import("../src/db/contacts");
    expect(() => updatePerson(db, ctx, regina, { customValues: { [f]: "nao-existe" } })).toThrow(/não encontrado/);
    updatePerson(db, ctx, regina, { customValues: { [f]: id } });
    expect(getPerson(db, regina)!.customValues[f]).toBe(id);
  });
});

describe("funis por categoria", () => {
  it("lista por tipo (comercial, projeto, operacional) e depois por nome", async () => {
    const { db, ctx } = await freshDb();
    for (const [name, type] of [
      ["Suporte Claudia", "operacional"],
      ["PowerCubus", "comercial"],
      ["Casa", "projeto"],
      ["Perseus", "comercial"],
      ["ágil", "comercial"],
    ] as const) {
      createPipeline(db, ctx, { name, type, stages: [{ name: "A" }] });
    }
    expect(listPipelines(db).map((p) => p.name)).toEqual(["ágil", "Perseus", "PowerCubus", "Casa", "Suporte Claudia"]);
  });
});

describe("GED: migração dos anexos antigos", () => {
  it("anexos de cartão e tarefa viram documentos não classificados, com os vínculos da tela; o conteúdo sai do banco", async () => {
    const db = await emptyDb();
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
    for (const m of MIGRATIONS.filter((x) => x.name < "0005")) {
      db.exec(m.sql);
      db.run("INSERT INTO _migrations VALUES (?, ?)", [m.name, new Date().toISOString()]);
    }
    const ws = bootstrapOld(db);
    const ctx = { workspaceId: ws, userId: null };
    const pid = createPipeline(db, ctx, { name: "Negócios", type: "comercial", stages: [{ name: "A" }] });
    const org = createOrganization(db, ctx, { name: "Posto" });
    const person = createPerson(db, ctx, { name: "Regina" });
    const deal = createCard(db, ctx, { pipelineId: pid, title: "Negócio", personId: person, organizationId: org });
    const task = createActivity(db, ctx, { title: "Tarefa", dealId: deal });
    const attach = (id: string, type: string, eid: string, filename: string, bytes: number[]) =>
      db.run(
        "INSERT INTO attachment (id, workspace_id, entity_type, entity_id, filename, mime, size_bytes, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-01', '2026-10-01')",
        [id, ws, type, eid, filename, filename.endsWith(".pdf") ? "application/pdf" : "image/png", bytes.length, new Uint8Array(bytes)],
      );
    attach("a1", "deal", deal, "proposta.v2.pdf", [1, 2, 3]);
    attach("a2", "activity", task, "foto", [1, 2, 3]);
    attach("foto", "person", person, "foto.png", [9]); // foto de contato: fica fora do GED
    db.run("INSERT INTO tag (id, workspace_id, entity, name, created_at, updated_at) VALUES ('t1', ?, 'deal', 'Venda', 'x', 'x')", [ws]);
    const cfOld = createCustomField(db, ctx, { entity: "deal", name: "Origem", fieldType: "text" });
    void updateCard;

    expect(runMigrations(db)).toBe(MIGRATIONS.filter((x) => x.name >= "0005").length);
    bootstrap(db);
    expect(db.exec("PRAGMA foreign_keys")[0]!.values[0]![0]).toBe(1);
    expect(db.exec("SELECT name FROM tag")[0]!.values).toEqual([["Venda"]]);
    expect(db.exec("SELECT id FROM custom_field")[0]!.values).toEqual([[cfOld]]);
    expect(docs.listDocumentTypes(db)).toHaveLength(docs.DEFAULT_DOCUMENT_TYPES.length);

    const list = docs.listDocuments(db, { sort: "name", dir: "asc" }).items;
    expect(list.map((d) => [d.name, d.type_id, d.filename])).toEqual([
      ["foto", null, "foto"],
      ["proposta.v2", null, "proposta.v2.pdf"],
    ]);
    const kinds = (name: string) => list.find((d) => d.name === name)!.links.map((l) => `${l.type}${l.auto ? "*" : ""}`);
    expect(kinds("proposta.v2")).toEqual(["deal", "person*", "organization*"]);
    expect(kinds("foto")).toEqual(["deal*", "activity", "person*", "organization*"]);
    expect(list.find((d) => d.name === "proposta.v2")!.text_status).toBe("pending");

    // Mudança do conteúdo (feita em open com o SHA-256 real): duplicado vira um só.
    expect(
      docs
        .legacyBlobs(db)
        .map((b) => b.id)
        .sort(),
    ).toEqual(["a1", "a2"]);
    expect(Array.from(docs.legacyBytes(db, "a1")!)).toEqual([1, 2, 3]);
    const sha = "c".repeat(64);
    docs.finishLegacyBlob(db, ctx, "a1", sha);
    docs.finishLegacyBlob(db, ctx, "a2", sha);
    expect(docs.legacyBlobs(db)).toEqual([]);
    expect(db.exec("SELECT COUNT(*) FROM file_blob WHERE deleted_at IS NULL")[0]!.values[0]![0]).toBe(1);
    expect(db.exec("SELECT length(data) FROM attachment WHERE id IN ('a1', 'a2')")[0]!.values).toEqual([[0], [0]]);
    expect(db.exec("SELECT length(data) FROM attachment WHERE id = 'foto'")[0]!.values[0]![0]).toBe(1);
    expect(docs.documentStats(db).bytes).toBe(3);
    expect(docs.documentsBySha(db, sha)).toHaveLength(2);
  });
});

/** Base criada antes do GED (bootstrap atual também criaria os tipos). */
function bootstrapOld(db: DatabaseSync): string {
  const ws = "ws-antigo";
  db.run("INSERT INTO workspace (id, name, created_at, updated_at) VALUES (?, 'W', 'x', 'x')", [ws]);
  db.run("INSERT INTO activity_type (id, workspace_id, name, icon, created_at, updated_at) VALUES ('tt', ?, 'Tarefa', 'timer', 'x', 'x')", [ws]);
  return ws;
}

describe("nota com o arquivo de origem", () => {
  it("guarda a referência ao documento (ex.: áudio transcrito) e some se ele for para a lixeira", async () => {
    const { db, ctx, deal, type } = await setup();
    const audio = docs.createDocument(db, ctx, { name: "Áudio do cliente", typeId: type("Outros"), links: [{ type: "deal", id: deal }], file: file("audio.ogg", "audio/ogg") });
    methods["notes.add"](db, ctx, { entityType: "deal", entityId: deal, body: "Transcrição de áudio:\n\nBom dia", documentIds: [audio] });
    methods["notes.add"](db, ctx, { entityType: "deal", entityId: deal, body: "Nota comum" });
    const notes = methods["notes.list"](db, ctx, { entityType: "deal", entityId: deal });
    expect(notes.find((n) => n.body.startsWith("Transcrição"))!.documents).toEqual([expect.objectContaining({ id: audio, name: "Áudio do cliente", filename: "audio.ogg" })]);
    expect(notes.find((n) => n.body === "Nota comum")!.documents).toEqual([]);
    expect(() => methods["notes.add"](db, ctx, { entityType: "deal", entityId: deal, body: "x", documentIds: ["nao-existe"] })).toThrow(/Documento/);
    docs.trashDocument(db, ctx, audio);
    expect(methods["notes.list"](db, ctx, { entityType: "deal", entityId: deal }).find((n) => n.body.startsWith("Transcrição"))!.documents).toEqual([]);
  });
});
