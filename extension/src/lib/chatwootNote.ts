// Dados e texto da nota privada do ticket de ativação no Chatwoot (spec 24).

/** Campos da nota (mesmos nomes do módulo chatwoot-ativacao). */
export const CHATWOOT_FIELDS = [
  "email_cliente",
  "nome_responsavel",
  "usuario",
  "email_usuario",
  "qtd_turmas",
  "plano",
  "vencimento_boleto",
  "fim_vigencia",
  "valor",
  "razao_social",
  "nome_escola",
  "cnpj",
  "cep",
  "endereco",
  "email_financeiro",
] as const;
export type ChatwootField = (typeof CHATWOOT_FIELDS)[number];
export type ChatwootData = Record<ChatwootField, string>;

export const CHATWOOT_FIELD_LABEL: Record<ChatwootField, string> = {
  email_cliente: "E-mail do cliente (contato no Chatwoot)",
  nome_responsavel: "Nome do responsável",
  usuario: "Usuário",
  email_usuario: "Email usuário PowerCubus",
  qtd_turmas: "Qtd de turmas",
  plano: "Plano",
  vencimento_boleto: "Data de Vencimento do Boleto",
  fim_vigencia: "Fim da vigência",
  valor: "Valor",
  razao_social: "Razão social",
  nome_escola: "Nome da escola",
  cnpj: "CNPJ",
  cep: "CEP",
  endereco: "Endereço",
  email_financeiro: "E-mail para boletos e Nota Fiscal",
};

/** Texto da nota privada (igual ao módulo chatwoot-ativacao), com o memorando opcional no fim. */
export function chatwootNote(d: ChatwootData, memo = ""): string {
  const extra = memo.replace(/\s+$/, "").replace(/^\s*\n/, "");
  return [
    "**Solicito ativação de conta**",
    "",
    `Usuário: ${d.usuario}`,
    `Email usuário PowerCubus: ${d.email_usuario}`,
    `Qtd de turmas: ${d.qtd_turmas}`,
    `Plano: ${d.plano}`,
    `Data de Vencimento do Boleto: ${d.vencimento_boleto}`,
    `Fim da vigência: ${d.fim_vigencia}`,
    `Valor: ${d.valor}`,
    "",
    `Razão social: ${d.razao_social}`,
    `Nome da escola: ${d.nome_escola}`,
    `CNPJ: ${d.cnpj}`,
    `CEP: ${d.cep}`,
    `Endereço: ${d.endereco}`,
    `Nome do responsável: ${d.nome_responsavel}`,
    `Email para envio de boletos e Nota Fiscal: ${d.email_financeiro}`,
    ...(extra.trim() ? ["", extra] : []),
  ].join("\n");
}

/** O que falta (todos os 13 são obrigatórios no Chatwoot). */
export function chatwootMissing(d: Partial<ChatwootData>): ChatwootField[] {
  return CHATWOOT_FIELDS.filter((k) => !String(d[k] ?? "").trim());
}

