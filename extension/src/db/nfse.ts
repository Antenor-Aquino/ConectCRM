// NFS-e Nacional (spec 19), fase 1: empresas emissoras (escolhida a cada
// nota), rascunho da nota a partir do cartão e lista de pendências (campos
// obrigatórios do leiaute da DPS, Anexo I v1.01).
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import { isValidCnpj, isValidCpf, normalizeCnpj, optionalText, requireText, ValidationError } from "../lib/validate";
import { municipioPorIbge, municipioPorNome, servicoNacional } from "../lib/nfse/tabelas";

export type IssuerAccess = "a1" | "a3" | "govbr";
/** Situação perante o Simples Nacional (opSimpNac): 1 não optante, 2 MEI, 3 ME/EPP. */
export type SimplesOption = 1 | 2 | 3;

export const ACCESS_LABEL: Record<IssuerAccess, string> = { a1: "Certificado A1", a3: "Certificado A3 (token)", govbr: "Conta gov.br" };
export const SIMPLES_LABEL: Record<SimplesOption, string> = { 1: "Não optante", 2: "MEI", 3: "Simples Nacional (ME/EPP)" };
/** Regimes especiais de tributação municipal (regEspTrib). */
export const SPECIAL_REGIME_LABEL: Record<number, string> = {
  0: "Nenhum",
  1: "Ato cooperado (cooperativa)",
  2: "Estimativa",
  3: "Microempresa municipal",
  4: "Notário ou registrador",
  5: "Profissional autônomo",
  6: "Sociedade de profissionais",
};

export interface Issuer {
  id: string;
  cnpj: string;
  legal_name: string;
  municipal_reg: string | null;
  city_ibge: string | null;
  access: IssuerAccess;
  simples: SimplesOption;
  special_regime: number;
  active: number;
  /** Modelos da discriminação dos serviços e da observação (com {itens}, {pedido}…). */
  description_template: string | null;
  notes_template: string | null;
}

export interface IssuerInput {
  cnpj: string;
  legalName: string;
  municipalReg?: string | null;
  cityIbge?: string | null;
  access?: IssuerAccess;
  simples?: SimplesOption;
  specialRegime?: number;
  active?: boolean;
  descriptionTemplate?: string | null;
  notesTemplate?: string | null;
}

function issuerData(db: DatabaseSync, input: Partial<IssuerInput>, full: boolean, exceptId = ""): Record<string, SqlValue> {
  const data: Record<string, SqlValue> = {};
  if (full || input.cnpj !== undefined) {
    const cnpj = normalizeCnpj(input.cnpj);
    if (!cnpj || !isValidCnpj(cnpj)) throw new ValidationError("Informe um CNPJ válido para a empresa emissora.");
    if (one(db, "SELECT 1 FROM nfse_issuer WHERE cnpj = ? AND deleted_at IS NULL AND id <> ?", cnpj, exceptId))
      throw new ValidationError(`O CNPJ ${cnpj} já está cadastrado como empresa emissora.`);
    data.cnpj = cnpj;
  }
  if (full || input.legalName !== undefined) data.legal_name = requireText(input.legalName, "Informe a razão social da empresa emissora.");
  if (full || input.municipalReg !== undefined) data.municipal_reg = optionalText(input.municipalReg);
  if (full || input.cityIbge !== undefined) {
    const ibge = optionalText(input.cityIbge);
    if (ibge && !municipioPorIbge(ibge)) throw new ValidationError("Município da empresa emissora não encontrado na tabela do IBGE.");
    data.city_ibge = ibge;
  }
  if (full || input.access !== undefined) {
    const a = input.access ?? "a1";
    if (!(a in ACCESS_LABEL)) throw new ValidationError("Forma de acesso ao portal inválida.");
    data.access = a;
  }
  if (full || input.simples !== undefined) {
    const s = input.simples ?? 3;
    if (![1, 2, 3].includes(s)) throw new ValidationError("Situação no Simples Nacional inválida.");
    data.simples = s;
  }
  if (full || input.specialRegime !== undefined) {
    const r = input.specialRegime ?? 0;
    if (!(r in SPECIAL_REGIME_LABEL)) throw new ValidationError("Regime especial de tributação inválido.");
    data.special_regime = r;
  }
  if (input.active !== undefined) data.active = input.active ? 1 : 0;
  if (full || input.descriptionTemplate !== undefined) data.description_template = optionalText(input.descriptionTemplate);
  if (full || input.notesTemplate !== undefined) data.notes_template = optionalText(input.notesTemplate);
  return data;
}

export function createIssuer(db: DatabaseSync, ctx: DbContext, input: IssuerInput): string {
  return withTransaction(db, () => {
    return insertRow(db, ctx, "nfse_issuer", issuerData(db, input, true));
  });
}

export function updateIssuer(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<IssuerInput>): void {
  withTransaction(db, () => {
    if (!one(db, "SELECT 1 FROM nfse_issuer WHERE id = ? AND deleted_at IS NULL", id)) throw new ValidationError("Empresa emissora não encontrada.");
    const data = issuerData(db, patch, false, id);
    if (Object.keys(data).length) updateRow(db, ctx, "nfse_issuer", id, data);
  });
}

export function deleteIssuer(db: DatabaseSync, ctx: DbContext, id: string): void {
  softDelete(db, ctx, "nfse_issuer", id);
}

export function listIssuers(db: DatabaseSync, opts: { activeOnly?: boolean } = {}): Issuer[] {
  return many<Issuer>(
    db,
    `SELECT id, cnpj, legal_name, municipal_reg, city_ibge, access, simples, special_regime, active, description_template, notes_template FROM nfse_issuer
     WHERE deleted_at IS NULL ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY legal_name`,
  );
}

// ---------- Rascunho e pendências ----------

export interface NfseAddress {
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  uf: string | null;
  cityIbge: string | null;
}

export interface NfseService {
  /** Código de tributação nacional; null = item sem código. */
  tribNac: string | null;
  nbs: string | null;
  description: string;
  valueCents: number;
  /** Itens do negócio que formam este serviço. */
  itemIds: string[];
}

export interface NfseDraft {
  cardId: string;
  /** Empresa escolhida; sem escolha, a única ativa (se houver só uma). */
  issuer: Issuer | null;
  /** Empresas ativas para escolher na hora de emitir. */
  issuers: Issuer[];
  taker: {
    kind: "organization" | "person" | null;
    id: string | null;
    document: string | null;
    name: string | null;
    email: string | null;
    address: NfseAddress | null;
  };
  /** Uma nota por código de tributação; normalmente um só. */
  services: NfseService[];
  /** Itens do tipo produto (não entram na NFS-e). */
  productItems: string[];
  competence: string;
  placeIbge: string | null;
  /** Retenção do ISSQN (tpRetISSQN): 1 não retido, 2 retido pelo tomador. */
  issRetention: 1 | 2;
  /** Textos da nota, revisados pelo usuário a cada emissão. */
  texts: NfseTexts;
}

export interface NfseTexts {
  /** Discriminação dos serviços (xDescServ, até 1000). */
  description: string;
  /** Observação / informações complementares (xInfComp, até 2000). */
  notes: string;
  /** Número do pedido ou processo de compra (xPed, até 60). */
  orderNumber: string;
  /** De onde veio cada texto: salvo neste cartão, da última nota do cliente ou do modelo da empresa. */
  source: { description: "saved" | "template"; notes: "saved" | "last-taker" | "template" };
  /** O usuário já salvou (revisou) os textos deste cartão. */
  saved: boolean;
}

export const NFSE_LIMITS = { description: 1000, notes: 2000, orderNumber: 60 } as const;
export const DEFAULT_DESCRIPTION_TEMPLATE = "{itens}";

/** Campos dos modelos de texto. */
export const NFSE_TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: "itens", label: "Itens do negócio (um por linha)" },
  { key: "cliente", label: "Nome do cliente (tomador)" },
  { key: "documento_cliente", label: "CNPJ/CPF do cliente" },
  { key: "cartao", label: "Título do cartão" },
  { key: "pedido", label: "Nº do pedido / processo de compra" },
  { key: "competencia", label: "Mês de competência (MM/AAAA)" },
  { key: "valor", label: "Valor total (R$)" },
];

/** Troca os campos {x} conhecidos; os desconhecidos ficam (e viram pendência). */
export function renderNfseTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}

/** Campos {x} que sobraram sem preencher. */
export const unresolvedFields = (text: string) => [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[0]))];

export interface NfsePending {
  field: string;
  message: string;
  /** "error" impede a emissão; "warning" só avisa. */
  level: "error" | "warning";
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Rascunho da nota a partir do cartão (organização ou contato e itens), pela empresa escolhida. */
export function nfseDraftForCard(db: DatabaseSync, cardId: string, opts: { issuerId?: string | null; today?: Date } = {}): NfseDraft {
  const today = opts.today ?? new Date();
  const card = one<{ id: string; pipeline_id: string; title: string; value_cents: number; person_id: string | null; organization_id: string | null }>(
    db,
    "SELECT id, pipeline_id, title, value_cents, person_id, organization_id FROM deal WHERE id = ? AND deleted_at IS NULL",
    cardId,
  );
  if (!card) throw new ValidationError("Cartão não encontrado.");
  const issuers = listIssuers(db, { activeOnly: true });
  const saved = one<{ issuer_id: string | null; description: string | null; notes: string | null; order_number: string | null }>(
    db,
    "SELECT issuer_id, description, notes, order_number FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL",
    cardId,
  );
  if (opts.issuerId === undefined && saved?.issuer_id && issuers.some((i) => i.id === saved.issuer_id)) opts = { ...opts, issuerId: saved.issuer_id };
  const issuer = opts.issuerId ? (issuers.find((i) => i.id === opts.issuerId) ?? null) : issuers.length === 1 ? issuers[0]! : null;
  if (opts.issuerId && !issuer) throw new ValidationError("Empresa emissora não encontrada ou inativa.");

  let taker: NfseDraft["taker"] = { kind: null, id: null, document: null, name: null, email: null, address: null };
  if (card.organization_id) {
    const o = one<{ id: string; name: string; legal_name: string | null; cnpj: string | null; email: string | null; cep: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null }>(
      db,
      "SELECT id, name, legal_name, cnpj, email, cep, street, number, complement, district, city, state FROM organization WHERE id = ? AND deleted_at IS NULL",
      card.organization_id,
    );
    if (o) {
      const hasAddress = !!(o.cep || o.street || o.city);
      taker = {
        kind: "organization",
        id: o.id,
        document: o.cnpj,
        name: o.legal_name || o.name,
        email: o.email,
        address: hasAddress
          ? { cep: o.cep, street: o.street, number: o.number, complement: o.complement, district: o.district, city: o.city, uf: o.state, cityIbge: municipioPorNome(o.city, o.state)?.ibge ?? null }
          : null,
      };
    }
  }
  if (!taker.kind && card.person_id) {
    const p = one<{ id: string; name: string; cpf: string | null; email: string | null }>(db, "SELECT id, name, cpf, email FROM person WHERE id = ? AND deleted_at IS NULL", card.person_id);
    if (p) taker = { kind: "person", id: p.id, document: p.cpf, name: p.name, email: p.email, address: null };
  }

  const items = many<{ id: string; description: string; quantity: number; total_cents: number; kind: string | null; trib: string | null; nbs: string | null; pdesc: string | null; pname: string | null }>(
    db,
    `SELECT i.id, i.description, i.quantity, i.total_cents, p.kind, p.nfse_trib_nac AS trib, p.nfse_nbs AS nbs, p.description AS pdesc, p.name AS pname
     FROM deal_item i LEFT JOIN product p ON p.id = i.product_id
     WHERE i.deal_id = ? AND i.deleted_at IS NULL ORDER BY i.position`,
    cardId,
  );
  const services: NfseService[] = [];
  const productItems: string[] = [];
  const itemLines: string[] = [];
  for (const it of items) {
    if (it.kind === "produto") {
      productItems.push(it.description);
      continue;
    }
    const key = it.trib ?? null;
    let s = services.find((x) => x.tribNac === key);
    if (!s) services.push((s = { tribNac: key, nbs: it.nbs, description: "", valueCents: 0, itemIds: [] }));
    s.valueCents += it.total_cents;
    s.itemIds.push(it.id);
    const line = it.description || it.pdesc || it.pname || "";
    s.description = s.description ? `${s.description}\n${line}` : line;
    itemLines.push(it.quantity && it.quantity !== 1 ? `${String(it.quantity).replace(".", ",")} × ${line}` : line);
  }
  if (!items.length) {
    services.push({ tribNac: null, nbs: null, description: card.title, valueCents: card.value_cents, itemIds: [] });
    itemLines.push(card.title);
  }

  // Textos: os salvos neste cartão; senão o modelo da empresa (discriminação) e
  // a observação da última nota do mesmo cliente (ou o modelo).
  const orderNumber = saved?.order_number ?? "";
  const total = services.reduce((n, x) => n + x.valueCents, 0);
  const vars: Record<string, string> = {
    itens: itemLines.join("\n"),
    cliente: taker.name ?? "",
    documento_cliente: taker.document ?? "",
    cartao: card.title,
    pedido: orderNumber,
    competencia: `${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`,
    valor: (total / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
  };
  const lastNotes =
    !saved && taker.id
      ? one<{ notes: string | null }>(
          db,
          "SELECT notes FROM nfse_draft WHERE taker_id = ? AND card_id <> ? AND deleted_at IS NULL AND notes IS NOT NULL AND notes <> '' ORDER BY updated_at DESC LIMIT 1",
          taker.id,
          cardId,
        )?.notes
      : null;
  const texts: NfseTexts = saved
    ? { description: saved.description ?? "", notes: saved.notes ?? "", orderNumber, source: { description: "saved", notes: "saved" }, saved: true }
    : {
        description: renderNfseTemplate(issuer?.description_template || DEFAULT_DESCRIPTION_TEMPLATE, vars),
        notes: lastNotes ?? renderNfseTemplate(issuer?.notes_template ?? "", vars),
        orderNumber,
        source: { description: "template", notes: lastNotes ? "last-taker" : "template" },
        saved: false,
      };

  return {
    cardId,
    issuer,
    issuers,
    taker,
    services,
    productItems,
    competence: today.toISOString().slice(0, 10),
    placeIbge: issuer?.city_ibge ?? null,
    issRetention: 1,
    texts,
  };
}

/** Salva (revisa) os textos e a empresa da nota deste cartão. */
export function saveNfseDraft(
  db: DatabaseSync,
  ctx: DbContext,
  cardId: string,
  input: { issuerId?: string | null; description: string; notes?: string | null; orderNumber?: string | null },
): void {
  withTransaction(db, () => {
    const card = one<{ organization_id: string | null; person_id: string | null }>(db, "SELECT organization_id, person_id FROM deal WHERE id = ? AND deleted_at IS NULL", cardId);
    if (!card) throw new ValidationError("Cartão não encontrado.");
    if (input.issuerId && !one(db, "SELECT 1 FROM nfse_issuer WHERE id = ? AND deleted_at IS NULL AND active = 1", input.issuerId))
      throw new ValidationError("Empresa emissora não encontrada ou inativa.");
    const data = {
      issuer_id: input.issuerId ?? null,
      taker_id: card.organization_id ?? card.person_id,
      description: input.description.trim(),
      notes: optionalText(input.notes),
      order_number: optionalText(input.orderNumber),
    };
    const row = one<{ id: string }>(db, "SELECT id FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL", cardId);
    if (row) updateRow(db, ctx, "nfse_draft", row.id, data);
    else insertRow(db, ctx, "nfse_draft", { card_id: cardId, ...data });
  });
}

/** O que falta (ou está errado) para emitir, conforme o leiaute da DPS. */
export function nfsePending(d: NfseDraft): NfsePending[] {
  const out: NfsePending[] = [];
  const err = (field: string, message: string) => out.push({ field, message, level: "error" });
  const warn = (field: string, message: string) => out.push({ field, message, level: "warning" });

  // Prestador
  if (!d.issuer)
    err("issuer", d.issuers.length ? "Escolha por qual empresa a nota vai ser emitida." : "Cadastre uma empresa emissora (Configurações → Nota fiscal).");
  else if (!d.issuer.city_ibge) err("issuer.city", `Informe o município da empresa emissora ${d.issuer.legal_name}.`);

  // Tomador
  if (!d.taker.kind) err("taker", "O cartão não tem organização nem contato para ser o tomador da nota.");
  else {
    const doc = digits(d.taker.document);
    if (!doc) err("taker.document", d.taker.kind === "organization" ? "A organização do cartão não tem CNPJ." : "O contato do cartão não tem CPF.");
    else if (doc.length === 14 ? !isValidCnpj(doc) : doc.length === 11 ? !isValidCpf(doc) : true) err("taker.document", "CNPJ/CPF do tomador inválido.");
    if (!d.taker.name?.trim()) err("taker.name", "Informe o nome do tomador.");
    const a = d.taker.address;
    if (a) {
      const missing = [!digits(a.cep) && "CEP", !a.street?.trim() && "logradouro", !a.number?.trim() && "número", !a.district?.trim() && "bairro"].filter(Boolean);
      if (missing.length) err("taker.address", `Endereço do tomador incompleto: falta ${missing.join(", ")}.`);
      if (!a.cityIbge) err("taker.address.city", a.city ? `Município “${a.city}/${a.uf ?? "?"}” não encontrado na tabela do IBGE: confira a cidade e a UF.` : "Endereço do tomador sem cidade e UF.");
    } else if (d.taker.kind === "organization") warn("taker.address", "A organização não tem endereço: a nota sai só com CNPJ e nome.");
  }

  // Serviço e valores
  if (d.issuer && !d.placeIbge) err("place", "Informe o local da prestação do serviço.");
  for (const s of d.services) {
    const label = s.description.split("\n")[0] || "Serviço";
    if (!s.tribNac) err("service.tribNac", `“${label}” sem código de tributação nacional (Configurações → Produtos e serviços).`);
    else if (!servicoNacional(s.tribNac)) err("service.tribNac", `Código de tributação ${s.tribNac} não existe na lista nacional.`);
    if (!s.description.trim()) err("service.description", "Informe a descrição do serviço.");
    if (s.valueCents <= 0) err("service.value", `“${label}” sem valor.`);
  }
  // Textos da nota (personalizados a cada emissão)
  const t = d.texts;
  if (!t.description.trim()) err("texts.description", "Preencha a discriminação dos serviços.");
  else if (t.description.length > NFSE_LIMITS.description) err("texts.description", `A discriminação passa de ${NFSE_LIMITS.description} caracteres (tem ${t.description.length}).`);
  if (t.notes.length > NFSE_LIMITS.notes) err("texts.notes", `A observação passa de ${NFSE_LIMITS.notes} caracteres (tem ${t.notes.length}).`);
  if (t.orderNumber.length > NFSE_LIMITS.orderNumber) err("texts.orderNumber", `O nº do pedido passa de ${NFSE_LIMITS.orderNumber} caracteres.`);
  const open = unresolvedFields(`${t.description}\n${t.notes}`);
  if (open.length) err("texts.fields", `Texto com campo sem preencher: ${open.join(", ")}.`);
  if (!t.saved) err("texts.review", "Revise a discriminação dos serviços e a observação desta nota e salve antes de emitir.");
  if (d.services.length > 1) warn("services", `Os serviços têm ${d.services.length} códigos de tributação diferentes: sai uma nota por código.`);
  if (d.productItems.length) warn("products", `Itens do tipo produto não entram na NFS-e: ${d.productItems.join(", ")}.`);
  return out;
}
