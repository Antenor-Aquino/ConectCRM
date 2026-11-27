// Ficha do cartão (visão completa): ordem e visibilidade dos campos da coluna
// de dados, por funil (Editar funil → Ficha do cartão). Campos personalizados
// entram um a um ("cf:<id>"); os títulos de seção também podem ser movidos ou
// escondidos. Campo novo (ex.: personalizado criado depois) entra no fim.
import type { PipelineType } from "../db/pipelines";

export interface DetailItem {
  key: string;
  hidden?: boolean;
}

export interface DetailBlockDef {
  key: string;
  label: string;
  /** Tipos de funil em que existe (vazio = todos). */
  types?: PipelineType[];
  /** Título de seção (não é um campo). */
  section?: boolean;
}

export const DETAIL_BLOCKS: DetailBlockDef[] = [
  { key: "valor", label: "Valor e produtos/serviços" },
  { key: "descricao", label: "Descrição", types: ["operacional", "projeto"] },
  { key: "sla", label: "SLA", types: ["operacional"] },
  { key: "datas", label: "Início e prazo", types: ["projeto"] },
  { key: "secao:relacionamento", label: "Título “Relacionamento”", section: true },
  { key: "contato", label: "Contato" },
  { key: "outros_contatos", label: "Outros contatos" },
  { key: "organizacao", label: "Organização" },
  { key: "outras_organizacoes", label: "Outras organizações" },
  { key: "secao:detalhes", label: "Título “Mais detalhes”", section: true },
  { key: "responsavel", label: "Responsável" },
  { key: "tags", label: "Tags" },
];

const BUILTIN = new Set(DETAIL_BLOCKS.map((b) => b.key));
export const isDetailKey = (k: string) => BUILTIN.has(k) || /^cf:[\w-]+$/.test(k);

/** Blocos que existem neste tipo de funil. */
export const blocksFor = (type: PipelineType) => DETAIL_BLOCKS.filter((b) => !b.types || b.types.includes(type));

/** Ordem padrão: a de sempre, com os campos personalizados no fim (na ordem deles). */
export function defaultDetailLayout(type: PipelineType, customFieldIds: string[]): DetailItem[] {
  return [...blocksFor(type).map((b) => ({ key: b.key })), ...customFieldIds.map((id) => ({ key: `cf:${id}` }))];
}

export function parseDetailLayout(raw: string | null | undefined): DetailItem[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    return v
      .filter((x): x is DetailItem => !!x && typeof (x as DetailItem).key === "string" && isDetailKey((x as DetailItem).key))
      .map((x) => ({ key: x.key, ...(x.hidden ? { hidden: true } : {}) }));
  } catch {
    return null;
  }
}

/**
 * Layout salvo + o que existe hoje: tira o que não existe mais (campo
 * excluído, bloco de outro tipo de funil) e põe no fim o que é novo.
 */
export function resolveDetailLayout(saved: DetailItem[] | null, type: PipelineType, customFieldIds: string[]): DetailItem[] {
  const def = defaultDetailLayout(type, customFieldIds);
  if (!saved?.length) return def;
  const exists = new Set(def.map((d) => d.key));
  const seen = new Set<string>();
  const out: DetailItem[] = [];
  for (const it of saved) if (exists.has(it.key) && !seen.has(it.key)) (seen.add(it.key), out.push(it));
  for (const d of def) if (!seen.has(d.key)) out.push(d);
  return out;
}

/** O layout é igual ao padrão? (salva null, para acompanhar campos novos na ordem padrão). */
export const isDefaultLayout = (items: DetailItem[], type: PipelineType, customFieldIds: string[]) =>
  JSON.stringify(items.map((i) => [i.key, !!i.hidden])) === JSON.stringify(defaultDetailLayout(type, customFieldIds).map((i) => [i.key, false]));
