// Exporta várias tabelas para um .xlsx (uma aba por relatório). A lib xlsx é
// carregada só no clique, para não pesar na abertura do CRM.
export interface Sheet {
  name: string;
  rows: (string | number | null)[][];
}

export async function downloadWorkbook(filename: string, sheets: Sheet[]): Promise<void> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws["!cols"] = (s.rows[0] ?? []).map((_, i) => ({ wch: Math.min(40, Math.max(10, ...s.rows.map((r) => String(r[i] ?? "").length + 2))) }));
    // Nome de aba: até 31 caracteres, sem : \ / ? * [ ]
    XLSX.utils.book_append_sheet(book, ws, s.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
  }
  XLSX.writeFile(book, filename);
}
