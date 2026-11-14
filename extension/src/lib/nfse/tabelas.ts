// Tabelas oficiais da NFS-e Nacional (spec 19), dos anexos do gov.br:
// Anexo A (municípios IBGE) e Anexo B (lista nacional de serviços e NBS 2.0).
import municipios from "./municipios.json";
import listas from "./listas.json";

export interface Municipio {
  ibge: string;
  nome: string;
  uf: string;
}
export interface ServicoNacional {
  /** Código de tributação nacional (cTribNac), 6 dígitos. */
  codigo: string;
  descricao: string;
  /** Item da lista (grupo), ex.: "Serviços de Informática e congêneres." */
  grupo: string;
}

const MUN: Municipio[] = (municipios as [string, string, string][]).map(([ibge, nome, uf]) => ({ ibge, nome, uf }));
const SERV: ServicoNacional[] = (listas.servicos as [string, string, string][]).map(([codigo, descricao, grupo]) => ({ codigo, descricao, grupo }));
const NBS: { codigo: string; descricao: string }[] = (listas.nbs as [string, string][]).map(([codigo, descricao]) => ({ codigo, descricao }));

/** Sem acento, minúsculo, sem pontuação e espaços repetidos. */
export const normalizeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const BY_NAME = new Map(MUN.map((m) => [`${normalizeName(m.nome)}|${m.uf}`, m]));
const BY_IBGE = new Map(MUN.map((m) => [m.ibge, m]));

/** Município pelo nome e UF (como vem do endereço da organização). */
export function municipioPorNome(cidade: string | null | undefined, uf: string | null | undefined): Municipio | null {
  if (!cidade || !uf) return null;
  return BY_NAME.get(`${normalizeName(cidade)}|${uf.trim().toUpperCase()}`) ?? null;
}

export function municipioPorIbge(ibge: string | null | undefined): Municipio | null {
  return ibge ? (BY_IBGE.get(ibge) ?? null) : null;
}

export function buscarMunicipios(texto: string, limite = 20): Municipio[] {
  const t = normalizeName(texto);
  if (!t) return [];
  return MUN.filter((m) => normalizeName(`${m.nome} ${m.uf}`).includes(t) || m.ibge.startsWith(t)).slice(0, limite);
}

export function servicoNacional(codigo: string | null | undefined): ServicoNacional | null {
  return codigo ? (SERV.find((s) => s.codigo === codigo) ?? null) : null;
}

/** Busca na lista nacional por código (com ou sem pontos) ou por palavras da descrição. */
export function buscarServicos(texto: string, limite = 30): ServicoNacional[] {
  const digits = texto.replace(/\D/g, "");
  const words = normalizeName(texto).split(" ").filter(Boolean);
  if (!words.length) return SERV.slice(0, limite);
  return SERV.filter((s) => (digits.length >= 2 && (s.codigo.startsWith(digits) || s.codigo.replace(/^0/, "").startsWith(digits))) || words.every((w) => normalizeName(`${s.descricao} ${s.grupo}`).includes(w))).slice(
    0,
    limite,
  );
}

export function nbs(codigo: string | null | undefined) {
  return codigo ? (NBS.find((n) => n.codigo === codigo) ?? null) : null;
}

export function buscarNbs(texto: string, limite = 30) {
  const digits = texto.replace(/\D/g, "");
  const words = normalizeName(texto).split(" ").filter(Boolean);
  if (!words.length) return [];
  return NBS.filter((n) => (digits.length >= 2 && n.codigo.startsWith(digits)) || words.every((w) => normalizeName(n.descricao).includes(w))).slice(0, limite);
}

/** "010501" → "01.05.01" (como aparece no portal). */
export const formatTribNac = (c: string) => (c.length === 6 ? `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4)}` : c);
/** "101011100" → "1.0101.11.00". */
export const formatNbs = (c: string) => (c.length === 9 ? `${c[0]}.${c.slice(1, 5)}.${c.slice(5, 7)}.${c.slice(7)}` : c);
