// Campos que podem aparecer nos cartões do quadro, configurados por funil
// (Editar funil → Cartão). A ordem da lista é a ordem no cartão; o título
// é sempre exibido, o valor fica no topo e o responsável no rodapé.
import type { PipelineType } from "../db/pipelines";

export type CardFieldGroup = "Negócio" | "Contato" | "Organização";

export interface BuiltinCardField {
  key: string;
  label: string;
  group: CardFieldGroup;
  /** Tipos de funil em que o campo faz sentido (vazio = todos). */
  types?: PipelineType[];
}

export const BUILTIN_CARD_FIELDS: BuiltinCardField[] = [
  { key: "valor", label: "Valor", group: "Negócio", types: ["comercial"] },
  { key: "produtos", label: "Produtos e serviços", group: "Negócio", types: ["comercial"] },
  { key: "probabilidade", label: "Probabilidade da etapa", group: "Negócio", types: ["comercial"] },
  { key: "previsao_fechamento", label: "Previsão de fechamento", group: "Negócio", types: ["comercial"] },
  { key: "sla", label: "SLA", group: "Negócio", types: ["operacional"] },
  { key: "inicio", label: "Início", group: "Negócio", types: ["projeto"] },
  { key: "prazo", label: "Prazo", group: "Negócio", types: ["projeto"] },
  { key: "descricao", label: "Descrição", group: "Negócio", types: ["operacional", "projeto"] },
  { key: "etapa_dias", label: "Dias na etapa", group: "Negócio" },
  { key: "proxima_tarefa", label: "Próxima tarefa", group: "Negócio" },
  { key: "tarefas", label: "Tarefas concluídas", group: "Negócio" },
  { key: "notas", label: "Quantidade de notas", group: "Negócio" },
  { key: "tags", label: "Tags", group: "Negócio" },
  { key: "responsavel", label: "Responsável", group: "Negócio" },
  { key: "origem", label: "Origem", group: "Negócio" },
  { key: "criado_em", label: "Criado em", group: "Negócio" },
  { key: "contato", label: "Contato", group: "Contato" },
  { key: "contato_telefone", label: "Telefone do contato", group: "Contato" },
  { key: "contato_email", label: "E-mail do contato", group: "Contato" },
  { key: "organizacao", label: "Organização", group: "Organização" },
  { key: "org_cidade", label: "Cidade / UF", group: "Organização" },
  { key: "org_cnpj", label: "CNPJ", group: "Organização" },
  { key: "org_segmento", label: "Segmento", group: "Organização" },
  { key: "org_telefone", label: "Telefone da organização", group: "Organização" },
];

/** Prefixos dos campos personalizados: do cartão, do contato e da organização. */
export const CUSTOM_PREFIX = { deal: "cf:", person: "pcf:", organization: "ocf:" } as const;

/** Igual ao cartão de antes da configuração. */
export const DEFAULT_CARD_FIELDS: Record<PipelineType, string[]> = {
  comercial: ["valor", "contato", "responsavel"],
  operacional: ["contato", "sla", "responsavel"],
  projeto: ["contato", "prazo", "responsavel"],
};

export const MAX_CARD_FIELDS = 12;

export function builtinsFor(type: PipelineType): BuiltinCardField[] {
  return BUILTIN_CARD_FIELDS.filter((f) => !f.types || f.types.includes(type));
}

export function isCardFieldKey(key: string): boolean {
  return BUILTIN_CARD_FIELDS.some((f) => f.key === key) || /^(cf|pcf|ocf):[\w-]+$/.test(key);
}

/** Lista salva no funil (JSON) → chaves válidas; inválida ou vazia = padrão. */
export function parseCardFields(raw: string | null | undefined, type: PipelineType): string[] {
  if (!raw) return DEFAULT_CARD_FIELDS[type];
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) return [...new Set(list.filter((k): k is string => typeof k === "string" && isCardFieldKey(k)))].slice(0, MAX_CARD_FIELDS);
  } catch {
    /* padrão */
  }
  return DEFAULT_CARD_FIELDS[type];
}
