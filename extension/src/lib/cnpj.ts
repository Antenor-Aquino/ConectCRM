// Consulta de CNPJ (portada do wa-pipedrive): BrasilAPI, Minha Receita e
// ReceitaWS em paralelo, com os resultados combinados (o primeiro valor
// preenchido de cada campo vence; sócios e CNAEs são unidos).
import { cnpjDigits, isValidCnpj } from "./validate";

export interface CnpjData {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  situacao: string;
  tipo: string;
  abertura: string;
  porte: string;
  naturezaJuridica: string;
  capitalSocial: string;
  simples: string;
  mei: string;
  cnaePrincipal: { codigo: string; descricao: string };
  cnaesSecundarios: { codigo: string; descricao: string }[];
  endereco: { logradouro: string; numero: string; complemento: string; bairro: string; municipio: string; uf: string; cep: string };
  contato: { telefone1: string; telefone2: string; email: string };
  qsa: { nome: string; qualificacao: string }[];
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function formatCnpj(value: string | null | undefined): string {
  const d = cnpjDigits(value);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (value ?? "");
}

/** Máscara durante a digitação: 00.000.000/0000-00. */
export function formatCnpjInput(value: string): string {
  return cnpjDigits(value)
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

const brDate = (v: unknown) => {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
};
const money = (v: unknown) =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const yesNo = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "");
const cnae = (v: unknown) => {
  const d = cnpjDigits(String(v ?? ""));
  return d.length === 7 ? d.replace(/^(\d{2})(\d{2})(\d)(\d{2})$/, "$1.$2-$3-$4") : v ? String(v) : "";
};
const phone = (v: unknown) => {
  const d = cnpjDigits(String(v ?? ""));
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  return v ? String(v) : "";
};

export function normalizeBrasilApi(d: Raw): CnpjData {
  return {
    cnpj: formatCnpj(d.cnpj),
    razaoSocial: d.razao_social || "",
    nomeFantasia: d.nome_fantasia || "",
    situacao: d.descricao_situacao_cadastral || "",
    tipo: d.descricao_identificador_matriz_filial || "",
    abertura: brDate(d.data_inicio_atividade),
    porte: d.porte || "",
    naturezaJuridica: d.natureza_juridica || "",
    capitalSocial: money(d.capital_social),
    simples: yesNo(d.opcao_pelo_simples),
    mei: yesNo(d.opcao_pelo_mei),
    cnaePrincipal: { codigo: cnae(d.cnae_fiscal), descricao: d.cnae_fiscal_descricao || "" },
    cnaesSecundarios: (d.cnaes_secundarios || []).map((i: Raw) => ({ codigo: cnae(i.codigo), descricao: i.descricao || "" })),
    endereco: {
      logradouro: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(" "),
      numero: d.numero || "",
      complemento: d.complemento || "",
      bairro: d.bairro || "",
      municipio: d.municipio || "",
      uf: d.uf || "",
      cep: cnpjDigits(d.cep),
    },
    contato: { telefone1: phone(d.ddd_telefone_1), telefone2: phone(d.ddd_telefone_2), email: d.email || "" },
    qsa: (d.qsa || []).map((s: Raw) => ({ nome: s.nome_socio || "", qualificacao: s.qualificacao_socio || "" })),
  };
}

export function normalizeReceitaWs(d: Raw): CnpjData {
  return {
    cnpj: d.cnpj || "",
    razaoSocial: d.nome || "",
    nomeFantasia: d.fantasia || "",
    situacao: d.situacao || "",
    tipo: d.tipo || "",
    abertura: d.abertura || "",
    porte: d.porte || "",
    naturezaJuridica: d.natureza_juridica || "",
    capitalSocial: money(d.capital_social),
    simples: yesNo(d.simples?.optante),
    mei: yesNo(d.simei?.optante),
    cnaePrincipal: { codigo: d.atividade_principal?.[0]?.code || "", descricao: d.atividade_principal?.[0]?.text || "" },
    cnaesSecundarios: (d.atividades_secundarias || []).map((i: Raw) => ({ codigo: i.code || "", descricao: i.text || "" })),
    endereco: {
      logradouro: d.logradouro || "",
      numero: d.numero || "",
      complemento: d.complemento || "",
      bairro: d.bairro || "",
      municipio: d.municipio || "",
      uf: d.uf || "",
      cep: cnpjDigits(d.cep),
    },
    contato: { telefone1: d.telefone || "", telefone2: "", email: d.email || "" },
    qsa: (d.qsa || []).map((s: Raw) => ({ nome: s.nome || "", qualificacao: s.qual || "" })),
  };
}

function deepMerge(target: Raw, source: Raw): void {
  for (const [k, v] of Object.entries(source)) {
    if (Array.isArray(v)) {
      if (!(target[k] || []).length && v.length) target[k] = v;
    } else if (v && typeof v === "object") {
      target[k] ??= {};
      deepMerge(target[k], v);
    } else if (v && !target[k]) target[k] = typeof v === "string" ? v : String(v);
  }
}

/** Dados vazios com todos os campos (fonte sem e-mail, telefone etc. não deixa campo faltando). */
export function emptyCnpjData(): CnpjData {
  return {
    cnpj: "",
    razaoSocial: "",
    nomeFantasia: "",
    situacao: "",
    tipo: "",
    abertura: "",
    porte: "",
    naturezaJuridica: "",
    capitalSocial: "",
    simples: "",
    mei: "",
    cnaePrincipal: { codigo: "", descricao: "" },
    cnaesSecundarios: [],
    endereco: { logradouro: "", numero: "", complemento: "", bairro: "", municipio: "", uf: "", cep: "" },
    contato: { telefone1: "", telefone2: "", email: "" },
    qsa: [],
  };
}

export function mergeCnpjData(items: CnpjData[]): CnpjData {
  const merged: Raw = emptyCnpjData();
  for (const i of items) deepMerge(merged, i);
  const socios = new Map<string, Raw>();
  for (const s of items.flatMap((i) => i.qsa)) {
    if (!s.nome) continue;
    const cur = socios.get(s.nome.toUpperCase()) ?? { nome: "", qualificacao: "" };
    deepMerge(cur, s);
    socios.set(s.nome.toUpperCase(), cur);
  }
  merged.qsa = [...socios.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const cnaes = new Map<string, { codigo: string; descricao: string }>();
  for (const c of items.flatMap((i) => i.cnaesSecundarios)) {
    const key = `${c.codigo}|${c.descricao}`;
    if (!cnaes.has(key)) cnaes.set(key, c);
  }
  merged.cnaesSecundarios = [...cnaes.values()];
  return merged as CnpjData;
}

const PROVIDERS: { name: string; url: (c: string) => string; normalize: (d: Raw) => CnpjData }[] = [
  { name: "BrasilAPI", url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, normalize: normalizeBrasilApi },
  { name: "Minha Receita", url: (c) => `https://minhareceita.org/${c}`, normalize: normalizeBrasilApi },
  { name: "ReceitaWS", url: (c) => `https://www.receitaws.com.br/v1/cnpj/${c}`, normalize: normalizeReceitaWs },
];

export type CnpjLookup = { ok: true; data: CnpjData; sources: string[] } | { ok: false; error: string };

/** Cada fonte tem este tempo para responder (a ReceitaWS às vezes trava ou demora). */
export const CNPJ_TIMEOUT_MS = 10_000;

/** Depois que uma fonte responde, as outras têm só este tempo a mais (para completar dados). */
export const CNPJ_GRACE_MS = 1_500;

export async function lookupCnpj(raw: string, fetchFn: typeof fetch = fetch, timeoutMs = CNPJ_TIMEOUT_MS, graceMs = CNPJ_GRACE_MS): Promise<CnpjLookup> {
  const cnpj = cnpjDigits(raw);
  if (!isValidCnpj(cnpj)) return { ok: false, error: "CNPJ inválido. Informe 14 dígitos válidos." };
  const failures: string[] = [];
  const ctrls = PROVIDERS.map(() => new AbortController());
  let graceStarted = false;
  const settled = await Promise.allSettled(
    PROVIDERS.map(async (p, i) => {
      const ctrl = ctrls[i]!;
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchFn(p.url(cnpj), { headers: { Accept: "application/json" }, signal: ctrl.signal });
        const payload = (await res.json().catch(() => null)) as Raw | null;
        if (res.status === 404) throw new Error(`${p.name}: CNPJ não encontrado`);
        if (res.status === 429) throw new Error(`${p.name}: limite de consultas, tente em 1 minuto`);
        if (!res.ok || !payload || payload.status === "ERROR") throw new Error(`${p.name}: ${payload?.message || `HTTP ${res.status}`}`);
        const data = p.normalize(payload);
        if (!graceStarted) {
          graceStarted = true;
          setTimeout(() => ctrls.forEach((c) => c.abort()), graceMs);
        }
        return { source: p.name, data };
      } catch (e) {
        failures[i] = ctrl.signal.aborted
          ? `${p.name}: sem resposta`
          : e instanceof Error
            ? e.message.startsWith(p.name)
              ? e.message
              : `${p.name}: sem conexão`
            : `${p.name}: erro`;
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (ok.length === 0) return { ok: false, error: `Não foi possível consultar o CNPJ (${failures.filter(Boolean).join("; ")}).` };
  return { ok: true, data: mergeCnpjData(ok.map((o) => o.data)), sources: ok.map((o) => o.source) };
}

/** Campos do cadastro de organização preenchidos pela consulta (spec 04). */
export function cnpjToOrganizationFields(data: CnpjData) {
  const d = mergeCnpjData([data]);
  return {
    name: d.nomeFantasia || d.razaoSocial,
    legalName: d.razaoSocial,
    segment: d.cnaePrincipal.descricao,
    phone: d.contato.telefone1,
    email: d.contato.email.toLowerCase(),
    cep: d.endereco.cep,
    street: d.endereco.logradouro,
    number: d.endereco.numero,
    complement: d.endereco.complemento,
    district: d.endereco.bairro,
    city: d.endereco.municipio,
    state: d.endereco.uf,
  };
}
