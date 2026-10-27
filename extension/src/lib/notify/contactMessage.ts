// Lembrete para o contato por WhatsApp (spec 10): o modelo da mensagem e o
// preenchimento das variáveis. Usado pelo banco (texto que sai), pelo
// formulário da atividade (prévia) e por Configurações (modelo padrão).

export const CONTACT_TEMPLATE_DEFAULT = [
  "Olá, {nome}! 👋",
  "Passando para lembrar da nossa conversa {quando} às {hora}.",
  "🔗 {link}",
  "Se surgir algum imprevisto, é só me avisar por aqui. Até já!",
  "{meu_nome} · {minha_empresa}",
].join("\n");

export const CONTACT_MINUTES_DEFAULT = 60;
export const CONTACT_MINUTES_OPTIONS = [15, 30, 60, 120, 1440];

export const CONTACT_VARIABLES: { key: string; label: string; example: string }[] = [
  { key: "nome", label: "Primeiro nome do contato", example: "Maria" },
  { key: "nome_completo", label: "Nome completo do contato", example: "Maria José da Silva" },
  { key: "quando", label: "hoje / amanhã / na terça, 28/10", example: "hoje" },
  { key: "hora", label: "Hora do início", example: "10:00" },
  { key: "data", label: "Data do início", example: "28/10/2026" },
  { key: "link", label: "Link da reunião", example: "https://meet.google.com/abc-defg-hij" },
  { key: "atividade", label: "Nome da atividade", example: "Apresentação da proposta" },
  { key: "meu_nome", label: "Seu nome (responsável)", example: "Antenor" },
  { key: "minha_empresa", label: "Empresa do funil do cartão", example: "AEB Sistemas" },
];

export interface ContactVars {
  personName: string;
  start: Date;
  link: string | null;
  activityTitle: string;
  myName: string;
  /** Empresa do funil do cartão vinculado (vazio = sem funil ou sem empresa). */
  company: string | null;
}

const WEEKDAY = ["no domingo", "na segunda", "na terça", "na quarta", "na quinta", "na sexta", "no sábado"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "hoje", "amanhã" ou "na terça, 28/10" (em relação a `now`). */
export function whenText(start: Date, now = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(start) - day(now)) / 86400_000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return `${WEEKDAY[start.getDay()]}, ${pad(start.getDate())}/${pad(start.getMonth() + 1)}`;
}

/**
 * Preenche o modelo. Sem link, some a linha do {link}; sem empresa, some o
 * {minha_empresa} com o que o liga ao nome (" · ", " - ", ", ", " da/de/do ").
 * `now` define o {quando} (no envio, é a hora do envio).
 */
export function renderContactMessage(template: string, v: ContactVars, now = new Date()): string {
  let t = template.replace(/\r\n/g, "\n");
  if (!v.link?.trim()) t = t.split("\n").filter((line) => !line.includes("{link}")).join("\n");
  if (!v.company?.trim()) t = t.replace(/(?:\s+(?:da|de|do)\s+|\s*[·•\-–—|,]\s*)?\{minha_empresa\}/gi, "");
  const first = v.personName.trim().split(/\s+/)[0] ?? "";
  const values: Record<string, string> = {
    nome: first,
    nome_completo: v.personName.trim(),
    quando: whenText(v.start, now),
    hora: `${pad(v.start.getHours())}:${pad(v.start.getMinutes())}`,
    data: `${pad(v.start.getDate())}/${pad(v.start.getMonth() + 1)}/${v.start.getFullYear()}`,
    link: v.link?.trim() ?? "",
    atividade: v.activityTitle,
    meu_nome: v.myName,
    minha_empresa: v.company?.trim() ?? "",
  };
  return t
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k]! : m))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "1 hora antes", "30 min antes", "1 dia antes". */
export function leadText(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} ${min === 1440 ? "dia" : "dias"} antes`;
  if (min % 60 === 0) return `${min / 60} ${min === 60 ? "hora" : "horas"} antes`;
  return `${min} min antes`;
}
