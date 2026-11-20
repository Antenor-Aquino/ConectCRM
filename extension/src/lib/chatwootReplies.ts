// Modelos de e-mail para o cliente pelo Chatwoot (spec 24): a resposta pública
// numa conversa da inbox de e-mail sai por e-mail para o contato. As variáveis
// vêm dos dados da ativação do cartão ({primeiro_nome}, {plano}…).
import type { ChatwootData } from "./chatwootNote";

export interface ReplyTemplate {
  id: "ativacao_nota_boleto" | "ativacao" | "nota_boleto" | "livre";
  label: string;
  text: string;
  /** Sugere anexar documentos (boleto, nota fiscal). */
  withAttachments: boolean;
}

export const REPLY_TEMPLATES: ReplyTemplate[] = [
  {
    id: "ativacao_nota_boleto",
    label: "Plataforma ativada + boleto e nota fiscal",
    withAttachments: true,
    text: [
      "Olá, {primeiro_nome}!",
      "",
      "A plataforma Powercubus da {nome_escola} já está ativada e pronta para uso.",
      "",
      "Dados de acesso:",
      "- Usuário: {usuario}",
      "- E-mail do usuário: {email_usuario}",
      "- Plano: {plano} ({qtd_turmas} turmas)",
      "- Vigência até: {fim_vigencia}",
      "",
      "Seguem em anexo o boleto e a nota fiscal, no valor de {valor}, com vencimento em {vencimento_boleto}. Os próximos boletos e notas fiscais serão enviados para {email_financeiro}.",
      "",
      "Qualquer dúvida, é só responder este e-mail.",
      "",
      "Atenciosamente,",
      "Equipe Powercubus",
    ].join("\n"),
  },
  {
    id: "ativacao",
    label: "Plataforma ativada",
    withAttachments: false,
    text: [
      "Olá, {primeiro_nome}!",
      "",
      "A plataforma Powercubus da {nome_escola} já está ativada e pronta para uso.",
      "",
      "Dados de acesso:",
      "- Usuário: {usuario}",
      "- E-mail do usuário: {email_usuario}",
      "- Plano: {plano} ({qtd_turmas} turmas)",
      "- Vigência até: {fim_vigencia}",
      "",
      "Qualquer dúvida, é só responder este e-mail.",
      "",
      "Atenciosamente,",
      "Equipe Powercubus",
    ].join("\n"),
  },
  {
    id: "nota_boleto",
    label: "Envio do boleto e da nota fiscal",
    withAttachments: true,
    text: [
      "Olá, {primeiro_nome}!",
      "",
      "Seguem em anexo o boleto e a nota fiscal referentes à plataforma Powercubus da {nome_escola}, no valor de {valor}, com vencimento em {vencimento_boleto}.",
      "",
      "Os próximos boletos e notas fiscais serão enviados para {email_financeiro}.",
      "",
      "Qualquer dúvida, é só responder este e-mail.",
      "",
      "Atenciosamente,",
      "Equipe Powercubus",
    ].join("\n"),
  },
  { id: "livre", label: "Texto livre", withAttachments: false, text: "Olá, {primeiro_nome}!\n\n\n\nAtenciosamente,\nEquipe Powercubus" },
];

/** Variáveis aceitas nos modelos. */
export const REPLY_VARIABLES = [
  "primeiro_nome",
  "nome_responsavel",
  "nome_escola",
  "razao_social",
  "usuario",
  "email_usuario",
  "plano",
  "qtd_turmas",
  "fim_vigencia",
  "valor",
  "vencimento_boleto",
  "email_financeiro",
] as const;

function values(d: ChatwootData): Record<string, string> {
  return {
    primeiro_nome: d.nome_responsavel.trim().split(/\s+/)[0] ?? "",
    nome_responsavel: d.nome_responsavel,
    nome_escola: d.nome_escola,
    razao_social: d.razao_social,
    usuario: d.usuario,
    email_usuario: d.email_usuario,
    plano: d.plano,
    qtd_turmas: d.qtd_turmas,
    fim_vigencia: d.fim_vigencia,
    valor: d.valor,
    vencimento_boleto: d.vencimento_boleto,
    email_financeiro: d.email_financeiro,
  };
}

/** Preenche as variáveis; as desconhecidas ficam como estão. */
export function renderReply(text: string, d: ChatwootData): string {
  const v = values(d);
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k]!.trim() : m));
}

/** Variáveis do modelo que estão sem valor no cartão (para avisar antes de enviar). */
export function emptyVariables(text: string, d: ChatwootData): string[] {
  const v = values(d);
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].filter((k) => k in v && !v[k]!.trim());
}

/** Variáveis que sobraram no texto final (escritas errado ou fora da lista). */
export const leftoverVariables = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
