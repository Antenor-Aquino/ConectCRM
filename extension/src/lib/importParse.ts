// Conversão dos textos de uma planilha importada: valores em reais, datas,
// números, sim/não e listas. Aceita o formato brasileiro e o do Excel em inglês.

/** Sem acentos, minúsculo e só letras/números ("Não Resolvido" → "naoresolvido"). */
export function importKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** "R$ 1.234,56", "1,234.56", "1500" → número; null se não for número. */
export function parseNumber(raw: string | null | undefined): number | null {
  let s = String(raw ?? "")
    .replace(/[R$\s ]/g, "")
    .trim();
  if (!s) return null;
  const negative = /^-|^\(.*\)$/.test(s);
  s = s.replace(/[()-]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Os dois: o último é o decimal.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    // Um separador seguido de exatamente 3 dígitos (ou vários) é de milhar: "1.500", "1,500", "1.234.567".
    const thousands = parts.length > 2 || parts[1]!.length === 3;
    s = thousands ? parts.join("") : `${parts[0]}.${parts[1]}`;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

/** Valor em reais → centavos; null se vazio. Lança se não for valor. */
export function parseMoneyCents(raw: string | null | undefined, label: string): number | null {
  if (!String(raw ?? "").trim()) return null;
  const n = parseNumber(raw);
  if (n === null || n < 0) throw new Error(`${label}: valor "${raw}" não reconhecido.`);
  return Math.round(n * 100);
}

/** "15/01/2026", "15/01/26", "2026-01-15" (com ou sem hora) → partes da data; null se não for data. */
function dateParts(raw: string): { y: number; m: number; d: number; h: number; min: number; hasTime: boolean } | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)(?:[\s,T]+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  const h = m[4] !== undefined ? Number(m[4]) : 12;
  const min = m[5] !== undefined ? Number(m[5]) : 0;
  const check = new Date(y, mo - 1, d);
  if (mo < 1 || mo > 12 || check.getDate() !== d || h > 23 || min > 59) return null;
  return { y, m: mo, d, h, min, hasTime: m[4] !== undefined };
}

/** Data da planilha → ISO (ao meio-dia local quando não tem hora, como no formulário). */
export function parseImportDate(raw: string | null | undefined, label: string): string | null {
  if (!String(raw ?? "").trim()) return null;
  const p = dateParts(String(raw));
  if (!p) throw new Error(`${label}: data "${raw}" não reconhecida (use dd/mm/aaaa).`);
  return new Date(p.y, p.m - 1, p.d, p.h, p.min, 0).toISOString();
}

/** Data da planilha → "aaaa-mm-dd" (campo personalizado do tipo data). */
export function parseImportDay(raw: string | null | undefined, label: string): string | null {
  if (!String(raw ?? "").trim()) return null;
  const p = dateParts(String(raw));
  if (!p) throw new Error(`${label}: data "${raw}" não reconhecida (use dd/mm/aaaa).`);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** "Sim", "S", "X", "1", "Verdadeiro", "Yes", "True" → true; "Não", "0"... → false; vazio → null. */
export function parseYesNo(raw: string | null | undefined): boolean | null {
  const k = importKey(String(raw ?? ""));
  if (!k) return null;
  return ["sim", "s", "x", "1", "verdadeiro", "v", "yes", "y", "true", "ok"].includes(k);
}

/** "a; b, c" → ["a", "b", "c"] (tags e listas de opções). */
export function splitList(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[;,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
