// Busca livre (GED): sem acento, sem diferença de maiúsculas, qualquer
// pedaço de palavra e em qualquer ordem ("comp ender regina").

export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Termos da busca, já normalizados (sem repetidos). */
export function searchTerms(q: string): string[] {
  return [...new Set(normalizeText(q).split(" ").filter(Boolean))];
}

/** Padrão LIKE de um termo (com % e _ escapados; usar ESCAPE '\'). */
export function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
