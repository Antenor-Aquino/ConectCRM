// Planilhas (Excel/CSV) para importar e exportar listas - mesma biblioteca
// da gestao-financeira-extensao (xlsx).
import * as XLSX from "xlsx";

/** Lê a primeira aba: cabeçalhos e linhas (texto). */
export async function readSpreadsheet(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const buffer = await file.arrayBuffer();
  const wb = /\.(csv|txt)$/i.test(file.name)
    ? XLSX.read(decodeCsv(buffer), { type: "string", cellDates: true })
    : XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  const [head = [], ...body] = matrix;
  const headers = head.map((h) => String(h ?? "").trim());
  const rows = body.map((r) => headers.map((_, i) => String(r[i] ?? "").trim())).filter((r) => r.some((c) => c !== ""));
  return { headers, rows };
}

/** CSV em UTF-8 (com ou sem BOM) ou, se não for UTF-8 válido, Windows-1252
 * (o padrão do Excel em português) - sem isso "Colégio" vira "ColÃ©gio". */
export function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/** Baixa um .xlsx com as colunas e linhas informadas. */
export function downloadSpreadsheet(filename: string, sheetName: string, headers: string[], rows: (string | number | null)[][]): void {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = headers.map((h, i) => ({ wch: Math.min(50, Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Sugere a coluna da planilha para cada campo pelo nome do cabeçalho. */
export function guessMapping(headers: string[], fields: { key: string; aliases: string[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  const norm = headers.map(strip);
  for (const f of fields) {
    const idx = norm.findIndex((h) => f.aliases.some((a) => strip(a) === h));
    if (idx >= 0) out[f.key] = idx;
  }
  return out;
}
