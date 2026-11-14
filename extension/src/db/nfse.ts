// NFS-e Nacional (spec 19), fase 1: empresas emissoras, funil → empresa,
// rascunho da nota a partir do cartão e lista de pendências (campos
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
  /** Funis que emitem por esta empresa. */
  pipeline_ids: string[];
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
  pipelineIds?: string[];
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
  return data;
}

/** Funis da empresa: cada funil emite por uma empresa só (o funil sai da anterior). */
function setIssuerPipelines(db: DatabaseSync, ctx: DbContext, issuerId: string, pipelineIds: string[]): void {
  const want = new Set(pipelineIds);
  for (const pid of want) if (!one(db, "SELECT 1 FROM pipeline WHERE id = ? AND deleted_at IS NULL", pid)) throw new ValidationError("Funil não encontrado.");
  const rows = many<{ id: string; pipeline_id: string; issuer_id: string }>(
    db,
    "SELECT id, pipeline_id, issuer_id FROM nfse_pipeline_issuer WHERE deleted_at IS NULL AND (issuer_id = ? OR pipeline_id IN (SELECT value FROM json_each(?)))",
    issuerId,
    JSON.stringify([...want]),
  );
  for (const r of rows) {
    if (r.issuer_id === issuerId && want.has(r.pipeline_id)) want.delete(r.pipeline_id);
    else softDelete(db, ctx, "nfse_pipeline_issuer", r.id);
  }
  for (const pid of want) insertRow(db, ctx, "nfse_pipeline_issuer", { pipeline_id: pid, issuer_id: issuerId });
}

export function createIssuer(db: DatabaseSync, ctx: DbContext, input: IssuerInput): string {
  return withTransaction(db, () => {
    const id = insertRow(db, ctx, "nfse_issuer", issuerData(db, input, true));
    setIssuerPipelines(db, ctx, id, input.pipelineIds ?? []);
    return id;
  });
}

export function updateIssuer(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<IssuerInput>): void {
  withTransaction(db, () => {
    if (!one(db, "SELECT 1 FROM nfse_issuer WHERE id = ? AND deleted_at IS NULL", id)) throw new ValidationError("Empresa emissora não encontrada.");
    const data = issuerData(db, patch, false, id);
    if (Object.keys(data).length) updateRow(db, ctx, "nfse_issuer", id, data);
    if (patch.pipelineIds) setIssuerPipelines(db, ctx, id, patch.pipelineIds);
  });
}

export function deleteIssuer(db: DatabaseSync, ctx: DbContext, id: string): void {
  withTransaction(db, () => {
    setIssuerPipelines(db, ctx, id, []);
    softDelete(db, ctx, "nfse_issuer", id);
  });
}

export function listIssuers(db: DatabaseSync): Issuer[] {
  const list = many<Omit<Issuer, "pipeline_ids">>(db, "SELECT id, cnpj, legal_name, municipal_reg, city_ibge, access, simples, special_regime, active FROM nfse_issuer WHERE deleted_at IS NULL ORDER BY legal_name");
  const links = many<{ issuer_id: string; pipeline_id: string }>(db, "SELECT issuer_id, pipeline_id FROM nfse_pipeline_issuer WHERE deleted_at IS NULL");
  return list.map((i) => ({ ...i, pipeline_ids: links.filter((l) => l.issuer_id === i.id).map((l) => l.pipeline_id) }));
}

/** Empresa que emite pelo funil; sem escolha, a única empresa ativa (se houver só uma). */
export function issuerForPipeline(db: DatabaseSync, pipelineId: string): Issuer | null {
  const all = listIssuers(db).filter((i) => i.active);
  return all.find((i) => i.pipeline_ids.includes(pipelineId)) ?? (all.length === 1 ? all[0]! : null);
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
  issuer: Issuer | null;
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
}

export interface NfsePending {
  field: string;
  message: string;
  /** "error" impede a emissão; "warning" só avisa. */
  level: "error" | "warning";
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Rascunho da nota a partir do cartão (organização ou contato, itens e funil). */
export function nfseDraftForCard(db: DatabaseSync, cardId: string, today = new Date()): NfseDraft {
  const card = one<{ id: string; pipeline_id: string; title: string; value_cents: number; person_id: string | null; organization_id: string | null }>(
    db,
    "SELECT id, pipeline_id, title, value_cents, person_id, organization_id FROM deal WHERE id = ? AND deleted_at IS NULL",
    cardId,
  );
  if (!card) throw new ValidationError("Cartão não encontrado.");
  const issuer = issuerForPipeline(db, card.pipeline_id);

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

  const items = many<{ id: string; description: string; total_cents: number; kind: string | null; trib: string | null; nbs: string | null; pdesc: string | null; pname: string | null }>(
    db,
    `SELECT i.id, i.description, i.total_cents, p.kind, p.nfse_trib_nac AS trib, p.nfse_nbs AS nbs, p.description AS pdesc, p.name AS pname
     FROM deal_item i LEFT JOIN product p ON p.id = i.product_id
     WHERE i.deal_id = ? AND i.deleted_at IS NULL ORDER BY i.position`,
    cardId,
  );
  const services: NfseService[] = [];
  const productItems: string[] = [];
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
  }
  if (!items.length) services.push({ tribNac: null, nbs: null, description: card.title, valueCents: card.value_cents, itemIds: [] });

  return {
    cardId,
    issuer,
    taker,
    services,
    productItems,
    competence: today.toISOString().slice(0, 10),
    placeIbge: issuer?.city_ibge ?? null,
    issRetention: 1,
  };
}

/** O que falta (ou está errado) para emitir, conforme o leiaute da DPS. */
export function nfsePending(d: NfseDraft): NfsePending[] {
  const out: NfsePending[] = [];
  const err = (field: string, message: string) => out.push({ field, message, level: "error" });
  const warn = (field: string, message: string) => out.push({ field, message, level: "warning" });

  // Prestador
  if (!d.issuer) err("issuer", "Nenhuma empresa emissora para o funil deste cartão (Configurações → Nota fiscal).");
  else {
    if (!d.issuer.active) err("issuer", `A empresa emissora ${d.issuer.legal_name} está inativa.`);
    if (!d.issuer.city_ibge) err("issuer.city", `Informe o município da empresa emissora ${d.issuer.legal_name}.`);
  }

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
  if (!d.placeIbge) err("place", "Informe o local da prestação do serviço.");
  for (const s of d.services) {
    const label = s.description.split("\n")[0] || "Serviço";
    if (!s.tribNac) err("service.tribNac", `“${label}” sem código de tributação nacional (Configurações → Produtos e serviços).`);
    else if (!servicoNacional(s.tribNac)) err("service.tribNac", `Código de tributação ${s.tribNac} não existe na lista nacional.`);
    if (!s.description.trim()) err("service.description", "Informe a descrição do serviço.");
    if (s.valueCents <= 0) err("service.value", `“${label}” sem valor.`);
  }
  if (d.services.length > 1) warn("services", `Os serviços têm ${d.services.length} códigos de tributação diferentes: sai uma nota por código.`);
  if (d.productItems.length) warn("products", `Itens do tipo produto não entram na NFS-e: ${d.productItems.join(", ")}.`);
  return out;
}
