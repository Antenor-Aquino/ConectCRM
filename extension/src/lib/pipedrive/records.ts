// Registros do Pipedrive → linhas de importação (spec 09): lista dos campos de
// origem (padrão e personalizados, com o valor já legível), campos de destino
// no CRM, sugestão do de-para e montagem da linha com o de-para escolhido.
import type { CustomField } from "../../db/customFields";
import type { ExternalDealRow, ExternalOrganizationRow, ExternalPersonRow } from "../../db/externalImport";
import { formatDate } from "../format";
import { importKey } from "../importParse";
import { pdTime, type PdEntity, type PdField, type PdRaw, type PdUser } from "./api";

export interface PdMeta {
  fields: PdField[];
  users: PdUser[];
  leadLabels?: { id: string; name: string }[];
}

export interface SourceField {
  key: string;
  label: string;
  custom: boolean;
  /** Valores legíveis (vários para campos de múltipla escolha, e-mails...). */
  get: (raw: PdRaw) => string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const list = (...v: unknown[]) => v.map(str).filter(Boolean);
const CUSTOM_KEY = /^[0-9a-f]{40}$/;

/** Id de uma referência (número, string ou objeto {id}/{value} da v1). */
export function refId(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (isObj(v)) return str(v.id ?? v.value) || undefined;
  return str(v) || undefined;
}

export const ownerIdOf = (raw: PdRaw) => refId(raw.owner_id);
export const orgIdOf = (raw: PdRaw) => refId(raw.org_id ?? raw.organization_id);
export const personIdOf = (raw: PdRaw) => refId(raw.person_id);

/** E-mails/telefones: v2 `emails`/`phones` [{value, primary}], v1 `email`/`phone`. */
function contacts(raw: PdRaw, kind: "email" | "phone"): { value: string; primary: boolean }[] {
  const v = raw[`${kind}s`] ?? raw[kind];
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.map((x) => (isObj(x) ? { value: str(x.value), primary: !!x.primary } : { value: str(x), primary: false })).filter((x) => x.value);
}
const primary = (raw: PdRaw, kind: "email" | "phone") => {
  const all = contacts(raw, kind);
  return (all.find((x) => x.primary) ?? all[0])?.value;
};

function optionLabel(field: PdField | undefined, id: unknown): string {
  const key = isObj(id) ? str(id.id ?? id.value ?? id.label) : str(id);
  return field?.options?.find((o) => String(o.id) === key)?.label ?? key;
}

/** Valor de um campo personalizado (v2 em custom_fields, v1 na raiz) em texto. */
function customValues(field: PdField, raw: PdRaw, users: Map<string, PdUser>): string[] {
  const v = isObj(raw.custom_fields) && field.key in raw.custom_fields ? raw.custom_fields[field.key] : raw[field.key];
  if (v === null || v === undefined || v === "") return [];
  switch (field.field_type) {
    case "enum":
      return list(optionLabel(field, v));
    case "set":
      return (Array.isArray(v) ? v : String(v).split(",")).map((x) => optionLabel(field, x)).filter(Boolean);
    case "monetary":
      return list(isObj(v) ? (v.value ?? v.amount) : v);
    case "user": {
      const id = refId(v);
      return list(isObj(v) && v.name ? v.name : (users.get(id ?? "")?.name ?? id));
    }
    case "org":
    case "people":
      return list(isObj(v) ? (v.name ?? v.value) : v);
    case "address":
      return list(isObj(v) ? (v.formatted_address ?? v.value) : v);
    case "daterange":
    case "timerange":
      return isObj(v) ? list([str(v.start ?? v.value), str(v.end ?? v.until)].filter(Boolean).join(" – ")) : list(v);
    default:
      return list(isObj(v) ? (v.value ?? JSON.stringify(v)) : Array.isArray(v) ? v.join("; ") : v);
  }
}

/** Partes do endereço da organização: v2 em `address`, v1 em `address_*`. */
function addressPart(raw: PdRaw, part: string): string {
  return isObj(raw.address) ? str(raw.address[part]) : str(raw[`address_${part}`]);
}

export function sourceFields(entity: PdEntity, meta: PdMeta): SourceField[] {
  const users = new Map(meta.users.map((u) => [String(u.id), u]));
  const byKey = new Map(meta.fields.map((f) => [f.key, f]));
  const std = (key: string, label: string, get: SourceField["get"]): SourceField => ({ key, label, custom: false, get });
  const owner = std("owner", "Responsável", (r) => list(users.get(ownerIdOf(r) ?? "")?.name ?? ownerIdOf(r)));
  const created = std("add_time", "Data de criação", (r) => list(formatDate(pdTime(r.add_time))));
  let base: SourceField[];
  if (entity === "person") {
    const labelField = byKey.get("label_ids") ?? byKey.get("label");
    base = [
      std("name", "Nome", (r) => list(r.name)),
      std("first_name", "Primeiro nome", (r) => list(r.first_name)),
      std("last_name", "Sobrenome", (r) => list(r.last_name)),
      std("email", "E-mail (principal)", (r) => list(primary(r, "email"))),
      std("emails", "Todos os e-mails", (r) => contacts(r, "email").map((x) => x.value)),
      std("phone", "Telefone (principal)", (r) => list(primary(r, "phone"))),
      std("phones", "Todos os telefones", (r) => contacts(r, "phone").map((x) => x.value)),
      owner,
      std("labels", "Etiquetas", (r) => (Array.isArray(r.label_ids) ? r.label_ids : list(r.label)).map((x) => optionLabel(labelField, x))),
      created,
    ];
  } else if (entity === "organization") {
    const labelField = byKey.get("label_ids") ?? byKey.get("label");
    const part = (key: string, label: string, p: string) => std(key, label, (r) => list(addressPart(r, p)));
    base = [
      std("name", "Nome", (r) => list(r.name)),
      std("address", "Endereço completo", (r) =>
        list(isObj(r.address) ? (r.address.formatted_address ?? r.address.value) : (r.address_formatted_address ?? r.address)),
      ),
      part("address_route", "Endereço: rua", "route"),
      part("address_street_number", "Endereço: número", "street_number"),
      part("address_subpremise", "Endereço: complemento", "subpremise"),
      part("address_sublocality", "Endereço: bairro", "sublocality"),
      part("address_locality", "Endereço: cidade", "locality"),
      part("address_admin_area_level_1", "Endereço: estado", "admin_area_level_1"),
      part("address_postal_code", "Endereço: CEP", "postal_code"),
      part("address_country", "Endereço: país", "country"),
      owner,
      std("labels", "Etiquetas", (r) => (Array.isArray(r.label_ids) ? r.label_ids : list(r.label)).map((x) => optionLabel(labelField, x))),
      created,
    ];
  } else {
    const labels = new Map((meta.leadLabels ?? []).map((l) => [l.id, l.name]));
    base = [
      std("title", "Título", (r) => list(r.title)),
      std("value", "Valor", (r) => list(isObj(r.value) ? r.value.amount : r.value)),
      std("currency", "Moeda", (r) => list(isObj(r.value) ? r.value.currency : r.currency)),
      std("expected_close_date", "Data prevista de fechamento", (r) => list(r.expected_close_date)),
      std("source_name", "Origem do lead", (r) => list(r.source_name)),
      std("origin", "Origem (sistema)", (r) => list(r.origin)),
      owner,
      std("labels", "Etiquetas", (r) => (Array.isArray(r.label_ids) ? r.label_ids : []).map((id) => labels.get(String(id)) ?? String(id))),
      created,
    ];
  }
  const custom = meta.fields
    .filter((f) => CUSTOM_KEY.test(f.key))
    .map<SourceField>((f) => ({ key: f.key, label: f.name, custom: true, get: (r) => customValues(f, r, users) }));
  return [...base, ...custom];
}

/** Resumo para a lista de resultados. */
export interface PdSummary {
  id: string;
  name: string;
  addTime: string;
  updateTime: string;
  email?: string;
  phone?: string;
  cnpj?: string;
  detail: string;
  ownerId?: string;
  orgId?: string;
  personId?: string;
}

export function summarize(entity: PdEntity, raw: PdRaw, sources?: SourceField[]): PdSummary {
  const base = { id: str(raw.id), addTime: pdTime(raw.add_time), updateTime: pdTime(raw.update_time), ownerId: ownerIdOf(raw) };
  if (entity === "person")
    return {
      ...base,
      name: str(raw.name),
      email: primary(raw, "email"),
      phone: primary(raw, "phone"),
      orgId: orgIdOf(raw),
      detail: list(primary(raw, "email"), primary(raw, "phone")).join(" · "),
    };
  if (entity === "organization") {
    const cnpjSource = sources?.find((s) => s.custom && importKey(s.label) === "cnpj");
    return {
      ...base,
      name: str(raw.name),
      cnpj: cnpjSource?.get(raw)[0],
      detail: list(addressPart(raw, "locality"), addressPart(raw, "admin_area_level_1")).join(" - "),
    };
  }
  const value = isObj(raw.value) ? raw.value : undefined;
  return {
    ...base,
    name: str(raw.title),
    personId: personIdOf(raw),
    orgId: orgIdOf(raw),
    detail: value?.amount ? `${str(value.currency)} ${Number(value.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`.trim() : "",
  };
}

// ---------- Destinos no CRM ----------

export type CrmEntity = "person" | "organization" | "deal";
export const CRM_ENTITY: Record<PdEntity, CrmEntity> = { person: "person", organization: "organization", lead: "deal" };

export interface CrmTarget {
  key: string;
  label: string;
  field?: CustomField;
}

const STANDARD_TARGETS: Record<CrmEntity, [string, string, string[]][]> = {
  person: [
    ["name", "Nome", ["nome"]],
    ["email", "E-mail", ["email", "e-mail"]],
    ["phone", "Celular", ["celular", "telefone", "whatsapp"]],
    ["notes", "Notas", ["notas", "observacoes", "obs"]],
  ],
  organization: [
    ["name", "Nome", ["nome", "nome fantasia"]],
    ["legalName", "Razão social", ["razao social"]],
    ["cnpj", "CNPJ", ["cnpj"]],
    ["website", "Site", ["site", "website", "url", "pagina"]],
    ["segment", "Segmento", ["segmento", "ramo", "setor", "ramo de atividade"]],
    ["email", "E-mail", ["email", "e-mail"]],
    ["phone", "Telefone", ["telefone", "fone"]],
    ["cep", "CEP", ["cep"]],
    ["street", "Logradouro", ["logradouro", "rua"]],
    ["number", "Número", ["numero"]],
    ["complement", "Complemento", ["complemento"]],
    ["district", "Bairro", ["bairro"]],
    ["city", "Cidade", ["cidade", "municipio"]],
    ["state", "Estado", ["estado", "uf"]],
    ["country", "País", ["pais"]],
    ["description", "Descrição", ["descricao", "observacoes"]],
  ],
  deal: [
    ["title", "Nome da negociação", ["titulo", "nome"]],
    ["value", "Valor", ["valor"]],
    ["expectedCloseAt", "Previsão de fechamento", ["previsao de fechamento", "data prevista de fechamento"]],
    ["origin", "Origem", ["origem"]],
    ["description", "Descrição", ["descricao"]],
  ],
};

export function crmTargets(entity: CrmEntity, customFields: CustomField[]): CrmTarget[] {
  return [
    ...STANDARD_TARGETS[entity].map(([key, label]) => ({ key, label })),
    { key: "owner", label: "Responsável" },
    { key: "tags", label: "Tags" },
    ...customFields.filter((f) => f.field_type !== "document").map((f) => ({ key: `cf:${f.id}`, label: f.name, field: f })),
  ];
}

/** Destino fixo dos campos padrão do Pipedrive. */
const STANDARD_GUESS: Record<PdEntity, Record<string, string>> = {
  person: { name: "name", email: "email", phone: "phone", owner: "owner", labels: "tags" },
  organization: {
    name: "name",
    address_route: "street",
    address_street_number: "number",
    address_subpremise: "complement",
    address_sublocality: "district",
    address_locality: "city",
    address_admin_area_level_1: "state",
    address_postal_code: "cep",
    address_country: "country",
    owner: "owner",
    labels: "tags",
  },
  lead: { title: "title", value: "value", expected_close_date: "expectedCloseAt", source_name: "origin", owner: "owner", labels: "tags" },
};

/** Sugestão do de-para: padrões fixos; personalizados pelo nome (ex.: "CNPJ" → CNPJ). Cada destino uma vez. */
export function guessFieldMapping(entity: PdEntity, sources: SourceField[], targets: CrmTarget[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const crm = CRM_ENTITY[entity];
  for (const s of sources) {
    const t = STANDARD_GUESS[entity][s.key];
    if (t && targets.some((x) => x.key === t)) {
      out[s.key] = t;
      used.add(t);
    }
  }
  for (const s of sources.filter((x) => x.custom)) {
    const k = importKey(s.label);
    const hit = targets.find(
      (t) =>
        !used.has(t.key) &&
        (importKey(t.label) === k || STANDARD_TARGETS[crm].some(([key, , aliases]) => key === t.key && aliases.some((a) => importKey(a) === k))),
    );
    if (hit) {
      out[s.key] = hit.key;
      used.add(hit.key);
    }
  }
  return out;
}

/** Sugestão da opção do CRM para um valor da origem (pelo rótulo). */
export function guessOption(target: CrmTarget, label: string): string {
  return target.field?.options.find((o) => importKey(o.label) === importKey(label))?.id ?? "";
}

export const OWNER_ME = "__me";
export const OWNER_NONE = "__none";

export interface PdMapping {
  /** Campo do Pipedrive → destino no CRM (ausente/"" = não importar). */
  fields: Record<string, string>;
  /** Usuário do Pipedrive → usuário do CRM, OWNER_ME ou OWNER_NONE. */
  owners: Record<string, string>;
  /** Destino de lista → valor normalizado da origem → opção do CRM. */
  options: Record<string, Record<string, string>>;
  pipelineId?: string;
  stageId?: string;
}

export type PdRow = ExternalPersonRow & ExternalOrganizationRow & ExternalDealRow;

/** Monta a linha de importação de um registro com o de-para. */
export function buildRow(entity: PdEntity, raw: PdRaw, sources: SourceField[], targets: CrmTarget[], mapping: PdMapping): PdRow {
  const s = summarize(entity, raw);
  const row: PdRow = { externalId: s.id, label: s.name || `#${s.id}`, sourceUpdatedAt: s.updateTime || null };
  const bySource = new Map(sources.map((x) => [x.key, x]));
  const byTarget = new Map(targets.map((x) => [x.key, x]));
  for (const [srcKey, tgtKey] of Object.entries(mapping.fields)) {
    const src = bySource.get(srcKey);
    const tgt = byTarget.get(tgtKey);
    if (!src || !tgt) continue;
    const values = src.get(raw);
    if (tgt.key === "owner") {
      const m = mapping.owners[ownerIdOf(raw) ?? ""] ?? OWNER_ME;
      row.ownerId = m === OWNER_ME ? undefined : m === OWNER_NONE ? null : m;
    } else if (tgt.key === "tags") {
      row.tags = values;
    } else if (tgt.field) {
      row.custom ??= {};
      const t = tgt.field.field_type;
      if (t === "select" || t === "multiselect") {
        const ids = values.map((v) => mapping.options[tgt.key]?.[importKey(v)] ?? "").filter(Boolean);
        if (ids.length) row.custom[tgt.field.id] = t === "multiselect" ? [...new Set(ids)] : ids[0]!;
      } else if (values.length) row.custom[tgt.field.id] = values.join("; ");
    } else {
      (row as unknown as Record<string, unknown>)[tgt.key] = values.join("; ");
    }
  }
  if (entity === "person") row.organizationExternalId = s.orgId;
  if (entity === "lead") {
    row.personExternalId = s.personId;
    row.organizationExternalId = s.orgId;
  }
  return row;
}
