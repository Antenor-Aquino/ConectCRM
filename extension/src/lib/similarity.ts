// Nomes parecidos (anti-duplicidade): compara o texto digitado com cada
// pedaço do nome já cadastrado (e vice-versa), sem acento nem maiúsculas.
// Ex.: "Anten" × "Antenor Aquino" → "anten" × "antenor" = 71%.
import { normalizeText } from "./search";

/** Acima disto (estritamente) o nome é considerado parecido. */
export const SIMILAR_THRESHOLD = 0.7;

// Ligações e sufixos de empresa não contam ("Stepple Ltda" = "Stepple").
const IGNORED = new Set(["a", "o", "e", "da", "de", "do", "das", "dos", "ltda", "me", "mei", "epp", "eireli", "sa", "s/a", "cia"]);

export function nameTokens(s: string): string[] {
  return normalizeText(s)
    .replace(/[^a-z0-9/]+/g, " ")
    .split(" ")
    .filter((t) => t && !IGNORED.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 0;
}

/** Sequências contínuas de palavras com tamanho perto de `size`. */
function windows(tokens: string[], size: number): string[] {
  const out: string[] = [];
  for (let n = Math.max(1, size - 1); n <= Math.min(tokens.length, size + 1); n++) {
    for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function best(text: string, size: number, parts: string[]): number {
  let max = 0;
  for (const w of windows(parts, size)) max = Math.max(max, ratio(text, w));
  return max;
}

/** 0..1: o maior grau de semelhança entre o texto e alguma parte do outro. */
export function nameSimilarity(typed: string, existing: string): number {
  const q = nameTokens(typed);
  const c = nameTokens(existing);
  const qs = q.join(" ");
  const cs = c.join(" ");
  if (qs.replace(/ /g, "").length < 3 || !cs) return 0;
  if (qs === cs) return 1;
  // Ordem trocada ("Aquino Antenor") conta como igual.
  const sorted = ratio([...q].sort().join(" "), [...c].sort().join(" "));
  const typedInExisting = best(qs, q.length, c);
  // Nome existente dentro de um texto maior ("Antenor Aquino Silva"); nomes muito curtos não.
  const existingInTyped = cs.replace(/ /g, "").length >= 4 ? best(cs, c.length, q) : 0;
  return Math.max(sorted, typedInExisting, existingInTyped);
}

export function isSimilar(score: number): boolean {
  return score > SIMILAR_THRESHOLD + 1e-9;
}
