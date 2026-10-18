import { describe, expect, it } from "vitest";
import { createActivity, setActivityDone, updateActivity } from "../src/db/activities";
import { cardHistory } from "../src/db/cardHistory";
import { createPerson } from "../src/db/contacts";
import { createCustomField, listCustomFields } from "../src/db/customFields";
import { createDocument, listDocumentTypes } from "../src/db/documents";
import { createCard, createLossReason, moveCard, setCardStatus, setDealItems, updateCard } from "../src/db/deals";
import { addNote } from "../src/db/notes";
import { createPipeline, listStages } from "../src/db/pipelines";
import { createProduct } from "../src/db/products";
import { createTag, setEntityTags } from "../src/db/tags";
import { createUser } from "../src/db/users";
import { formatCents as brl } from "../src/lib/format";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("histórico completo do cartão", () => {
  it("registra campos com antes → depois, produtos, tags, campos personalizados, notas, anexos e tarefas", async () => {
    const { db, ctx: sys } = await freshDb();
    const me = createUser(db, sys, { name: "Antenor", role: "admin" });
    const ctx = { ...sys, userId: me };
    const pid = createPipeline(db, ctx, { name: "Negócios", type: "comercial", stages: [{ name: "Prospect" }, { name: "Contato" }] });
    const [, s2] = listStages(db, pid);
    const regina = createPerson(db, ctx, { name: "Regina" });
    const id = createCard(db, ctx, { pipelineId: pid, title: "Negociação Teste", valueCents: 10000 });
    // Cada passo um minuto antes do seguinte, para não agrupar.
    const step = () => db.run("UPDATE change_log SET at = strftime('%Y-%m-%dT%H:%M:%fZ', at, '-1 minute')");
    step();
    updateCard(db, ctx, id, { valueCents: 20000, personId: regina });
    step();
    moveCard(db, ctx, id, { stageId: s2!.id });
    step();
    const p1 = createProduct(db, ctx, { name: "Licença", kind: "servico", priceCents: 5000 });
    setDealItems(db, ctx, id, [{ productId: p1, quantity: 2, discountCents: 1000 }, { description: "Implantação", unitPriceCents: 3000 }]);
    step();
    const items = methods["cards.get"](db, ctx, { id })!.items;
    const lic = items.find((i) => i.description === "Licença")!;
    setDealItems(db, ctx, id, [{ id: lic.id, productId: p1, quantity: 3, discountCents: 1000 }]);
    step();
    const tag = createTag(db, ctx, { entity: "deal", name: "Venda", color: "red" });
    setEntityTags(db, ctx, "deal", id, [tag]);
    step();
    const cf = createCustomField(db, ctx, { entity: "deal", name: "Origem do lead", fieldType: "select", options: [{ label: "Site" }, { label: "Indicação" }] });
    const opts = listCustomFields(db, "deal").find((f) => f.id === cf)!.options;
    updateCard(db, ctx, id, { customValues: { [cf]: opts[0]!.id } });
    step();
    updateCard(db, ctx, id, { customValues: { [cf]: opts[1]!.id } });
    step();
    addNote(db, ctx, "deal", id, "Cliente pediu desconto");
    createDocument(db, ctx, {
      name: "Proposta comercial",
      typeId: listDocumentTypes(db)[0]!.id,
      links: [{ type: "deal", id }],
      file: { sha256: "a".repeat(64), mime: "application/pdf", size: 3, filename: "proposta.pdf", location: "browser" },
    });
    step();
    const t = createActivity(db, ctx, { title: "Ligar", dealId: id, dueAt: "2026-10-20T13:00:00.000Z" });
    step();
    setActivityDone(db, ctx, t, true);
    step();
    updateActivity(db, ctx, t, { dueAt: "2026-10-21T13:00:00.000Z" });
    step();
    const lost = createLossReason(db, ctx, "Preço");
    setCardStatus(db, ctx, id, { status: "lost", lossReasonId: lost });

    const all = cardHistory(db, id).flatMap((e) => e.lines);
    const has = (re: RegExp) => expect(all.some((l) => re.test(l)), `faltou: ${re}\n${all.join("\n")}`).toBe(true);
    has(/^Criou o cartão "Negociação Teste" na etapa Prospect$/);
    has(new RegExp(`^Valor: ${esc(brl(10000))} → ${esc(brl(20000))}$`));
    has(/^Contato: vazio → Regina$/);
    has(/^Moveu de etapa: Prospect → Contato$/);
    has(/^Adicionou produto: Licença — 2 × .* − desc\. .* = /);
    has(/^Adicionou produto: Implantação — 1 × /);
    has(/^Removeu produto: Implantação$/);
    has(/^Alterou produto Licença: Quantidade: 2 → 3$/);
    has(/^Adicionou a tag Venda$/);
    has(/^Campo "Origem do lead": Site$/);
    has(/^Campo "Origem do lead": Site → Indicação$/);
    has(/^Adicionou nota: "Cliente pediu desconto"$/);
    has(/^Vinculou o documento Proposta comercial$/);
    has(/^Criou a atividade "Ligar" com início em /);
    has(/^Concluiu a atividade "Ligar"$/);
    has(/^Remarcou o início da atividade "Ligar": /);
    has(/^Marcou como perdido$/);
    has(/^Motivo da perda: vazio → Preço$/);
    // Nada interno vaza (posição, entrada na etapa etc.).
    expect(all.some((l) => /position|stage_entered|value_from_items|closed_at/.test(l))).toBe(false);
    // Mais recente primeiro, com o usuário.
    const events = cardHistory(db, id);
    expect(events[0]!.lines).toContain("Marcou como perdido");
    expect(events[0]!.userName).toBe("Antenor");
  });

  it("agrupa gravações do mesmo momento num só evento e respeita a permissão", async () => {
    const { db, ctx: sys } = await freshDb();
    createUser(db, sys, { name: "Admin", role: "admin" });
    const ana = createUser(db, sys, { name: "Ana", role: "vendedor" });
    const bruno = createUser(db, sys, { name: "Bruno", role: "vendedor" });
    const ctx = { ...sys, userId: ana };
    const pid = createPipeline(db, ctx, { name: "N", type: "comercial", stages: [{ name: "A" }] });
    const id = createCard(db, ctx, { pipelineId: pid, title: "X", ownerId: ana });
    db.run("UPDATE change_log SET at = strftime('%Y-%m-%dT%H:%M:%fZ', at, '-1 minute')");
    setDealItems(db, ctx, id, [{ description: "Item", unitPriceCents: 500 }]);
    const ev = cardHistory(db, id);
    // Produto + valor recalculado no mesmo evento.
    expect(ev[0]!.lines).toEqual([expect.stringMatching(/^Adicionou produto: Item/), expect.stringMatching(/^Valor: /)]);
    expect(() => methods["cards.history"](db, { ...sys, userId: bruno }, { id })).toThrow(/permissão/);
  });
});

describe("campos do cartão por funil", () => {
  async function setup() {
    const { db, ctx: sys } = await freshDb();
    const me = createUser(db, sys, { name: "Antenor Aquino", role: "admin" });
    const ctx = { ...sys, userId: me };
    const pid = createPipeline(db, ctx, { name: "Negócios", type: "comercial", stages: [{ name: "Prospect", probability: 30 }] });
    const { createOrganization } = await import("../src/db/contacts");
    const org = createOrganization(db, ctx, { name: "Posto 5 irmãos", city: "Curitiba", state: "PR", cnpj: "11222333000181" });
    const pcf = createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text" });
    const ocf = createCustomField(db, ctx, { entity: "organization", name: "Porte", fieldType: "select", options: [{ label: "Médio" }] });
    const dcf = createCustomField(db, ctx, { entity: "deal", name: "Urgência", fieldType: "boolean" });
    const porte = listCustomFields(db, "organization").find((f) => f.id === ocf)!.options[0]!.id;
    const { updateOrganization } = await import("../src/db/contacts");
    updateOrganization(db, ctx, org, { customValues: { [ocf]: porte } });
    const person = createPerson(db, ctx, { name: "Antenor Aquino", phone: "(41) 99999-8888", email: "antenor@exemplo.com", organizationIds: [org], customValues: { [pcf]: "Diretor" } });
    const id = createCard(db, ctx, { pipelineId: pid, title: "Negociação Teste", personId: person, valueCents: 20000, ownerId: me, customValues: { [dcf]: true } });
    const tag = createTag(db, ctx, { entity: "deal", name: "Venda", color: "red" });
    setEntityTags(db, ctx, "deal", id, [tag]);
    return { db, ctx, pid, id, pcf, ocf, dcf };
  }

  it("sem configuração, o cartão mostra o padrão de antes (valor, contato, responsável)", async () => {
    const { db, ctx, pid } = await setup();
    const card = methods["board.get"](db, ctx, { pipelineId: pid })[0]!.cards[0]!;
    expect(Object.keys(card.fields)).toEqual(["valor", "contato", "responsavel"]);
    expect(card.fields.contato).toEqual({ text: "Antenor Aquino" });
  });

  it("mostra campos do negócio, do contato, da organização e personalizados, na ordem escolhida", async () => {
    const { db, ctx, pid, pcf, ocf, dcf } = await setup();
    const keys = ["tags", "contato_telefone", "org_cidade", "org_cnpj", "probabilidade", `cf:${dcf}`, `pcf:${pcf}`, `ocf:${ocf}`, "organizacao"];
    methods["pipelines.update"](db, ctx, { id: pid, patch: { cardFields: keys } });
    const card = methods["board.get"](db, ctx, { pipelineId: pid })[0]!.cards[0]!;
    expect(Object.keys(card.fields)).toEqual(keys);
    expect(card.fields.tags).toEqual({ tags: [{ name: "Venda", color: "red" }] });
    expect(card.fields.contato_telefone).toEqual({ text: "(41) 99999-8888", phone: "+5541999998888" });
    expect(card.fields.org_cidade).toEqual({ text: "Curitiba / PR" });
    expect(card.fields.org_cnpj).toEqual({ text: "11.222.333/0001-81" });
    expect(card.fields.probabilidade).toEqual({ text: "30%" });
    expect(card.fields[`cf:${dcf}`]).toEqual({ text: "Sim", label: "Urgência" });
    expect(card.fields[`pcf:${pcf}`]).toEqual({ text: "Diretor", label: "Cargo" });
    expect(card.fields[`ocf:${ocf}`]).toEqual({ text: "Médio", label: "Porte" });
    // A prévia usa uma lista ainda não salva.
    const prev = methods["cards.previewFields"](db, ctx, { pipelineId: pid, keys: ["contato_email"] });
    expect(prev).toEqual({ title: "Negociação Teste", fields: { contato_email: { text: "antenor@exemplo.com", email: "antenor@exemplo.com" } } });
  });

  it("recusa chave inválida e volta ao padrão com null", async () => {
    const { db, ctx, pid } = await setup();
    expect(() => methods["pipelines.update"](db, ctx, { id: pid, patch: { cardFields: ["valor", "drop table"] } })).toThrow(/inválido/);
    methods["pipelines.update"](db, ctx, { id: pid, patch: { cardFields: ["valor"] } });
    methods["pipelines.update"](db, ctx, { id: pid, patch: { cardFields: null } });
    expect(Object.keys(methods["board.get"](db, ctx, { pipelineId: pid })[0]!.cards[0]!.fields)).toEqual(["valor", "contato", "responsavel"]);
  });
});
