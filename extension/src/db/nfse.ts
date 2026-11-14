// NFS-e Nacional (spec 19), fase 1: empresas emissoras (escolhida a cada
// nota), rascunho da nota a partir do cartão e lista de pendências (campos
// obrigatórios do leiaute da DPS, Anexo I v1.01).
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import { isValidCnpj, isValidCpf, normalizeCnpj, optionalText, requireText, ValidationError } from "../lib/validate";
import { municipioPorIbge, municipioPorNome, servicoNacional } from "../lib/nfse/tabelas";
import { addDocumentVersion, contextLinks, createDocument, type FileRef } from "./documents";

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
  /** API (spec 20): alíquota do Simples (pTotTribSN, %), regime de apuração (regApTribSN), alíquota do ISS (pAliq, %). */
  simples_rate: number | null;
  simples_regime: 1 | 2 | 3;
  iss_rate: number | null;
  dps_series: string;
  dps_next: number;
  cert_thumbprint: string | null;
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
  simplesRate?: number | null;
  simplesRegime?: 1 | 2 | 3;
  issRate?: number | null;
  dpsSeries?: string;
  dpsNext?: number;
  certThumbprint?: string | null;
}

/** Regime de apuração do Simples (regApTribSN). */
export const SIMPLES_REGIME_LABEL: Record<1 | 2 | 3, string> = {
  1: "Tributos federais e municipal (ISS) pelo Simples Nacional",
  2: "Federais pelo Simples; ISS fora do Simples (por sublimite)",
  3: "Federais e ISS fora do Simples (por sublimite/limite)",
};

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
  const rate = (v: number | null | undefined, label: string, max: number) => {
    if (v == null || (typeof v === "number" && Number.isNaN(v))) return null;
    if (typeof v !== "number" || v < 0 || v > max) throw new ValidationError(`${label} deve estar entre 0 e ${max}%.`);
    return Math.round(v * 100) / 100;
  };
  if (full || input.simplesRate !== undefined) data.simples_rate = rate(input.simplesRate, "A alíquota do Simples Nacional", 99.99);
  if (full || input.issRate !== undefined) data.iss_rate = rate(input.issRate, "A alíquota do ISS", 5);
  if (full || input.simplesRegime !== undefined) {
    const r = input.simplesRegime ?? 1;
    if (![1, 2, 3].includes(r)) throw new ValidationError("Regime de apuração do Simples inválido.");
    data.simples_regime = r;
  }
  if (full || input.dpsSeries !== undefined) {
    const sr = String(input.dpsSeries ?? "1").replace(/^0+/, "") || "0";
    if (!/^\d{1,5}$/.test(sr) || Number(sr) < 1 || Number(sr) > 49999) throw new ValidationError("A série da DPS deve estar entre 1 e 49999 (faixa de aplicativo próprio).");
    data.dps_series = sr;
  }
  if (input.dpsNext !== undefined) {
    if (!Number.isInteger(input.dpsNext) || input.dpsNext < 1) throw new ValidationError("O próximo número da DPS deve ser um inteiro a partir de 1.");
    data.dps_next = input.dpsNext;
  }
  if (full || input.certThumbprint !== undefined) data.cert_thumbprint = optionalText(input.certThumbprint);
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
    `SELECT id, cnpj, legal_name, municipal_reg, city_ibge, access, simples, special_regime, active, description_template, notes_template, simples_rate, simples_regime, iss_rate, dps_series, dps_next, cert_thumbprint FROM nfse_issuer
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
    /** Nome curto do cadastro no CRM (nome do arquivo do DANFSe). */
    shortName: string | null;
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
  /** Nota já emitida para este cartão (fase 3). */
  issued: NfseIssued | null;
}

export type NfseEnvironment = "producao" | "producao_restrita";
export interface NfseIssued {
  number: string | null;
  accessKey: string;
  environment: NfseEnvironment;
  issuedAt: string;
  /** XML da NFS-e (emitida pela API); null quando veio do portal. */
  xml: string | null;
  /** Cancelamento registrado (B4); null enquanto a nota vale. */
  canceled: NfseCanceled | null;
  /** DANFSe guardado no GED (documento do cartão) e se a versão salva já mostra "CANCELADA". */
  danfse: { documentId: string; canceled: boolean } | null;
}

export interface NfseCanceled {
  at: string;
  /** Código do motivo (1 erro na emissão, 2 serviço não prestado, 9 outros); null se só registrado (portal). */
  code: number | null;
  reason: string | null;
  /** Cancelada pela API (pedido de evento guardado) ou só registrada após cancelar no portal. */
  via: "api" | "portal";
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
export function nfseDraftForCard(
  db: DatabaseSync,
  cardId: string,
  opts: {
    issuerId?: string | null;
    today?: Date;
    /** "Reaplicar texto padrão": ignora os textos salvos e usa este nº de pedido. */
    fromTemplate?: boolean;
    orderNumber?: string | null;
  } = {},
): NfseDraft {
  const today = opts.today ?? new Date();
  const card = one<{ id: string; pipeline_id: string; title: string; value_cents: number; person_id: string | null; organization_id: string | null }>(
    db,
    "SELECT id, pipeline_id, title, value_cents, person_id, organization_id FROM deal WHERE id = ? AND deleted_at IS NULL",
    cardId,
  );
  if (!card) throw new ValidationError("Cartão não encontrado.");
  const issuers = listIssuers(db, { activeOnly: true });
  const saved = one<{
    issuer_id: string | null;
    description: string | null;
    notes: string | null;
    order_number: string | null;
    status: string;
    access_key: string | null;
    nfse_number: string | null;
    environment: string | null;
    issued_at: string | null;
    nfse_xml: string | null;
    canceled_at: string | null;
    cancel_code: number | null;
    cancel_reason: string | null;
    cancel_event_xml: string | null;
    danfse_doc_id: string | null;
    danfse_canceled: number;
  }>(
    db,
    `SELECT issuer_id, description, notes, order_number, status, access_key, nfse_number, environment, issued_at, nfse_xml, canceled_at, cancel_code, cancel_reason, cancel_event_xml,
            danfse_doc_id, danfse_canceled FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL`,
    cardId,
  );
  if (opts.issuerId === undefined && saved?.issuer_id && issuers.some((i) => i.id === saved.issuer_id)) opts = { ...opts, issuerId: saved.issuer_id };
  const issuer = opts.issuerId ? (issuers.find((i) => i.id === opts.issuerId) ?? null) : issuers.length === 1 ? issuers[0]! : null;
  if (opts.issuerId && !issuer) throw new ValidationError("Empresa emissora não encontrada ou inativa.");

  let taker: NfseDraft["taker"] = { kind: null, id: null, document: null, name: null, shortName: null, email: null, address: null };
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
        shortName: o.name,
        email: o.email,
        address: hasAddress
          ? { cep: o.cep, street: o.street, number: o.number, complement: o.complement, district: o.district, city: o.city, uf: o.state, cityIbge: municipioPorNome(o.city, o.state)?.ibge ?? null }
          : null,
      };
    }
  }
  if (!taker.kind && card.person_id) {
    const p = one<{ id: string; name: string; cpf: string | null; email: string | null }>(db, "SELECT id, name, cpf, email FROM person WHERE id = ? AND deleted_at IS NULL", card.person_id);
    if (p) taker = { kind: "person", id: p.id, document: p.cpf, name: p.name, shortName: p.name, email: p.email, address: null };
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
  const orderNumber = opts.orderNumber ?? saved?.order_number ?? "";
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
  const useSaved = !!saved && !opts.fromTemplate;
  const lastNotes =
    !useSaved && !opts.fromTemplate && taker.id
      ? one<{ notes: string | null }>(
          db,
          "SELECT notes FROM nfse_draft WHERE taker_id = ? AND card_id <> ? AND deleted_at IS NULL AND notes IS NOT NULL AND notes <> '' ORDER BY updated_at DESC LIMIT 1",
          taker.id,
          cardId,
        )?.notes
      : null;
  const texts: NfseTexts = useSaved
    ? { description: saved!.description ?? "", notes: saved!.notes ?? "", orderNumber, source: { description: "saved", notes: "saved" }, saved: true }
    : {
        description: renderNfseTemplate(issuer?.description_template || DEFAULT_DESCRIPTION_TEMPLATE, vars),
        notes: lastNotes ?? renderNfseTemplate(issuer?.notes_template ?? "", vars),
        orderNumber,
        source: { description: "template", notes: lastNotes ? "last-taker" : "template" },
        saved: !!saved,
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
    issued:
      saved?.status === "issued" && saved.access_key
        ? {
            number: saved.nfse_number, accessKey: saved.access_key, environment: (saved.environment as NfseEnvironment) ?? "producao", issuedAt: saved.issued_at ?? "",
            xml: saved.nfse_xml,
            canceled: saved.canceled_at
              ? { at: saved.canceled_at, code: saved.cancel_code, reason: saved.cancel_reason, via: saved.cancel_event_xml ? "api" : "portal" }
              : null,
            danfse:
              saved.danfse_doc_id && one(db, "SELECT 1 FROM document WHERE id = ? AND deleted_at IS NULL", saved.danfse_doc_id)
                ? { documentId: saved.danfse_doc_id, canceled: !!saved.danfse_canceled }
                : null,
          }
        : null,
  };
}

/** Chave de acesso da NFS-e nacional: 50 caracteres alfanuméricos. */
export const normalizeAccessKey = (v: string) => v.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
export const isAccessKey = (v: string) => /^[0-9A-Z]{50}$/.test(normalizeAccessKey(v));

/**
 * Nota emitida no Emissor Nacional: grava número e chave no rascunho do cartão
 * e deixa uma nota no histórico. Emitir de novo o mesmo cartão é recusado
 * (para outra nota, use um novo cartão ou cancele a anterior no portal).
 */
export function markNfseIssued(
  db: DatabaseSync,
  ctx: DbContext,
  cardId: string,
  input: { accessKey: string; number?: string | null; environment: NfseEnvironment; nfseXml?: string | null; via?: "portal" | "api" },
): void {
  const key = normalizeAccessKey(input.accessKey);
  if (!isAccessKey(key)) throw new ValidationError("Chave de acesso da NFS-e inválida (são 50 caracteres).");
  if (input.environment !== "producao" && input.environment !== "producao_restrita") throw new ValidationError("Ambiente do Emissor Nacional inválido.");
  withTransaction(db, () => {
    const row = one<{ id: string; status: string; access_key: string | null }>(db, "SELECT id, status, access_key FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL", cardId);
    if (!row) throw new ValidationError("Salve o rascunho da nota antes de emitir.");
    if (row.status === "issued") {
      if (row.access_key === key) return; // mesma nota lida de novo
      throw new ValidationError("Este cartão já tem uma NFS-e emitida.");
    }
    const number = optionalText(input.number);
    updateRow(db, ctx, "nfse_draft", row.id, {
      status: "issued",
      access_key: key,
      nfse_number: number,
      environment: input.environment,
      issued_at: new Date().toISOString(),
      nfse_xml: input.nfseXml ?? null,
    });
    const amb = input.environment === "producao_restrita" ? " (produção restrita, sem valor fiscal)" : "";
    insertRow(db, ctx, "note", {
      entity_type: "deal",
      entity_id: cardId,
      body: `NFS-e${number ? ` nº ${number}` : ""} emitida ${input.via === "api" ? "pela API do Emissor Nacional (ConectCRM Fiscal)" : "no Emissor Nacional"}${amb}.\nChave de acesso: ${key}`,
      document_ids: null,
    });
  });
}

const CANCEL_LABEL: Record<number, string> = { 1: "Erro na emissão", 2: "Serviço não prestado", 9: "Outros" };

/**
 * NFS-e cancelada (B4). Pela API: `code`, `reason` e o XML do evento devolvido
 * pela Sefin. Nota emitida no portal: só registra que foi cancelada lá.
 */
export function markNfseCanceled(
  db: DatabaseSync,
  ctx: DbContext,
  cardId: string,
  input: { accessKey: string; code?: number | null; reason?: string | null; eventXml?: string | null },
): void {
  const key = normalizeAccessKey(input.accessKey);
  const viaApi = !!input.eventXml;
  if (viaApi && !CANCEL_LABEL[input.code ?? 0]) throw new ValidationError("Motivo do cancelamento inválido.");
  withTransaction(db, () => {
    const row = one<{ id: string; status: string; access_key: string | null; nfse_number: string | null; canceled_at: string | null }>(
      db,
      "SELECT id, status, access_key, nfse_number, canceled_at FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL",
      cardId,
    );
    if (!row || row.status !== "issued") throw new ValidationError("Este cartão não tem NFS-e emitida.");
    if (row.access_key !== key) throw new ValidationError("A chave de acesso não é a da nota deste cartão.");
    if (row.canceled_at) return; // já registrado
    const reason = optionalText(input.reason);
    updateRow(db, ctx, "nfse_draft", row.id, {
      canceled_at: new Date().toISOString(),
      cancel_code: viaApi ? input.code! : null,
      cancel_reason: reason,
      cancel_event_xml: input.eventXml ?? null,
    });
    const motivo = viaApi ? `\nMotivo: ${CANCEL_LABEL[input.code!]}${reason ? ` — ${reason}` : ""}` : "";
    insertRow(db, ctx, "note", {
      entity_type: "deal",
      entity_id: cardId,
      body: `NFS-e${row.nfse_number ? ` nº ${row.nfse_number}` : ""} cancelada ${viaApi ? "pela API do Emissor Nacional (ConectCRM Fiscal)" : "no Emissor Nacional (registrado no ConectCRM)"}.${motivo}\nChave de acesso: ${key}`,
      document_ids: null,
    });
  });
}

/** "Caixa Escolar Prof. Hildebrando Pontes - 52,00 - DANFSe-NFS-e-1" (nome do documento e do arquivo). */
export function danfseDocumentName(takerShortName: string | null, totalCents: number, number: string | null, accessKey: string): string {
  const valor = (totalCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parts = [takerShortName?.trim(), valor, `DANFSe-NFS-e-${number ?? accessKey}`].filter(Boolean);
  return parts.join(" - ").replace(/[\\/:*?"<>|]/g, "_");
}

/**
 * Guarda o DANFSe (PDF) no GED, ligado ao cartão (e ao cliente), com o tipo
 * "Nota fiscal". Já guardado: nada muda, a não ser que a nota tenha sido
 * cancelada depois — aí entra uma nova versão (com a marca CANCELADA).
 */
export function saveNfseDanfse(db: DatabaseSync, ctx: DbContext, cardId: string, input: { file: FileRef; name: string; canceled: boolean }): string {
  return withTransaction(db, () => {
    const row = one<{ id: string; status: string; nfse_number: string | null; access_key: string | null; issued_at: string | null; danfse_doc_id: string | null; danfse_canceled: number }>(
      db,
      "SELECT id, status, nfse_number, access_key, issued_at, danfse_doc_id, danfse_canceled FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL",
      cardId,
    );
    if (!row || row.status !== "issued") throw new ValidationError("Este cartão não tem NFS-e emitida.");
    if (input.file.mime !== "application/pdf") throw new ValidationError("O DANFSe precisa ser um PDF.");
    const existing = row.danfse_doc_id && one(db, "SELECT 1 FROM document WHERE id = ? AND deleted_at IS NULL", row.danfse_doc_id) ? row.danfse_doc_id : null;
    if (existing) {
      if (input.canceled && !row.danfse_canceled) {
        addDocumentVersion(db, ctx, existing, input.file);
        updateRow(db, ctx, "nfse_draft", row.id, { danfse_canceled: 1 });
      }
      return existing;
    }
    let typeId = one<{ id: string }>(db, "SELECT id FROM document_type WHERE name = 'Nota fiscal' COLLATE NOCASE AND deleted_at IS NULL")?.id;
    if (!typeId) {
      const pos = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM document_type WHERE deleted_at IS NULL")?.p ?? -1;
      typeId = insertRow(db, ctx, "document_type", { name: "Nota fiscal", color: "amber", valid_days: null, position: pos + 1 });
    } else updateRow(db, ctx, "document_type", typeId, { active: 1 });
    const docId = createDocument(db, ctx, {
      name: input.name,
      typeId,
      docDate: row.issued_at ? row.issued_at.slice(0, 10) : null,
      description: `DANFSe da NFS-e${row.nfse_number ? ` nº ${row.nfse_number}` : ""}. Chave de acesso: ${row.access_key ?? "-"}`,
      links: contextLinks(db, "deal", cardId),
      file: input.file,
    });
    updateRow(db, ctx, "nfse_draft", row.id, { danfse_doc_id: docId, danfse_canceled: input.canceled ? 1 : 0 });
    return docId;
  });
}

/**
 * Depois de cancelar, prepara uma nota nova para o cartão: a cancelada fica
 * guardada (fora do rascunho atual) e os textos e a empresa são reaproveitados.
 */
export function reopenNfseDraft(db: DatabaseSync, ctx: DbContext, cardId: string): void {
  withTransaction(db, () => {
    const row = one<{ id: string; status: string; canceled_at: string | null; issuer_id: string | null; taker_id: string | null; description: string | null; notes: string | null; order_number: string | null }>(
      db,
      "SELECT id, status, canceled_at, issuer_id, taker_id, description, notes, order_number FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL",
      cardId,
    );
    if (!row || row.status !== "issued" || !row.canceled_at) throw new ValidationError("Só dá para preparar outra nota depois de cancelar a atual.");
    softDelete(db, ctx, "nfse_draft", row.id);
    insertRow(db, ctx, "nfse_draft", {
      card_id: cardId,
      issuer_id: row.issuer_id,
      taker_id: row.taker_id,
      description: row.description,
      notes: row.notes,
      order_number: row.order_number,
    });
  });
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
    const row = one<{ id: string; status: string; issuer_id: string | null }>(db, "SELECT id, status, issuer_id FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL", cardId);
    if (row?.status === "issued") throw new ValidationError("A NFS-e deste cartão já foi emitida: o rascunho não pode mais ser alterado.");
    // Trocou a empresa: o número de DPS reservado era da outra.
    if (row && row.issuer_id !== data.issuer_id) Object.assign(data, { dps_series: null, dps_number: null });
    if (row) updateRow(db, ctx, "nfse_draft", row.id, data);
    else insertRow(db, ctx, "nfse_draft", { card_id: cardId, ...data });
  });
}

/** O que falta (ou está errado) para emitir, conforme o leiaute da DPS. */
export function nfsePending(d: NfseDraft): NfsePending[] {
  const out: NfsePending[] = [];
  if (d.issued)
    return [
      {
        field: "issued",
        message: d.issued.canceled
          ? `NFS-e${d.issued.number ? ` nº ${d.issued.number}` : ""} deste cartão foi cancelada.`
          : `NFS-e já emitida para este cartão${d.issued.number ? ` (nº ${d.issued.number})` : ""}.`,
        level: "warning",
      },
    ];
  const err = (field: string, message: string) => out.push({ field, message, level: "error" });
  const warn = (field: string, message: string) => out.push({ field, message, level: "warning" });

  // Prestador
  if (!d.issuer)
    err("issuer", d.issuers.length ? "Escolha por qual empresa a nota vai ser emitida." : "Cadastre uma empresa emissora (Configurações → Nota fiscal).");
  else {
    if (!d.issuer.city_ibge) err("issuer.city", `Informe o município da empresa emissora ${d.issuer.legal_name}.`);
    if (d.issuer.simples === 3 && d.issuer.simples_rate == null)
      warn("issuer.simplesRate", `Informe a alíquota do Simples Nacional de ${d.issuer.legal_name} (Configurações → Nota fiscal): é obrigatória para emitir pela API.`);
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

/**
 * Número da DPS desta nota (spec 20): reservado no rascunho na 1ª tentativa de
 * envio. Reenviar a mesma nota (ex.: depois de uma recusa) usa o mesmo número;
 * cada nota nova pega o próximo da empresa.
 */
export function reserveDpsNumber(db: DatabaseSync, ctx: DbContext, cardId: string): { series: string; number: number } {
  return withTransaction(db, () => {
    const row = one<{ id: string; status: string; issuer_id: string | null; dps_series: string | null; dps_number: number | null }>(
      db,
      "SELECT id, status, issuer_id, dps_series, dps_number FROM nfse_draft WHERE card_id = ? AND deleted_at IS NULL",
      cardId,
    );
    if (!row) throw new ValidationError("Salve o rascunho da nota antes de emitir.");
    if (row.status === "issued") throw new ValidationError("A NFS-e deste cartão já foi emitida.");
    if (!row.issuer_id) throw new ValidationError("Escolha a empresa emissora.");
    if (row.dps_series && row.dps_number) return { series: row.dps_series, number: row.dps_number };
    const iss = one<{ dps_series: string; dps_next: number }>(db, "SELECT dps_series, dps_next FROM nfse_issuer WHERE id = ? AND deleted_at IS NULL", row.issuer_id);
    if (!iss) throw new ValidationError("Empresa emissora não encontrada.");
    updateRow(db, ctx, "nfse_issuer", row.issuer_id, { dps_next: iss.dps_next + 1 });
    updateRow(db, ctx, "nfse_draft", row.id, { dps_series: iss.dps_series, dps_number: iss.dps_next });
    return { series: iss.dps_series, number: iss.dps_next };
  });
}
