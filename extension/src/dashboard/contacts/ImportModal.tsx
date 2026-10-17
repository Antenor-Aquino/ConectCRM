// Importar planilha (Excel/CSV): escolher arquivo → conferir de qual coluna
// vem cada campo (sugerido pelo cabeçalho) → importar → resumo.
// Colunas com o mesmo nome de um campo personalizado entram automaticamente.
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { TaButton, TaModal, TaSelect } from "@tailadmin";
import type { ImportSummary } from "../../db/importer";
import { guessMapping, readSpreadsheet } from "../../lib/spreadsheet";
import { ErrorText } from "../ui/form";
import { errorText } from "../../lib/errors";

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

export function ImportModal({
  title,
  fields,
  customFieldNames,
  onImport,
  onClose,
}: {
  title: string;
  fields: ImportField[];
  customFieldNames: string[];
  /** Recebe as linhas já mapeadas ({campo: valor}, com customByName). */
  onImport: (rows: Record<string, unknown>[]) => Promise<ImportSummary>;
  onClose: () => void;
}) {
  const [sheet, setSheet] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customColumns = sheet ? sheet.headers.map((h, i) => [h, i] as const).filter(([h]) => customFieldNames.some((n) => n.toLowerCase() === h.toLowerCase())) : [];

  async function pick(file: File) {
    setError(null);
    try {
      const s = await readSpreadsheet(file);
      if (s.rows.length === 0) throw new Error("A planilha não tem linhas.");
      setSheet(s);
      setMapping(guessMapping(s.headers, fields));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function run() {
    if (!sheet) return;
    const missing = fields.filter((f) => f.required && mapping[f.key] === undefined);
    if (missing.length) return setError(`Escolha a coluna de: ${missing.map((f) => f.label).join(", ")}.`);
    setBusy(true);
    try {
      const rows = sheet.rows.map((r) => {
        const row: Record<string, unknown> = {};
        for (const f of fields) if (mapping[f.key] !== undefined) row[f.key] = r[mapping[f.key]!] ?? "";
        if (customColumns.length) row.customByName = Object.fromEntries(customColumns.map(([h, i]) => [h, r[i] ?? ""]));
        return row;
      });
      setSummary(await onImport(rows));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TaModal isOpen onClose={onClose} title={title} width="max-w-2xl">
      {summary ? (
        <div className="text-theme-sm text-gray-700 dark:text-gray-300">
          <p className="mb-3 rounded-lg bg-success-50 px-3 py-2 text-success-700">{summary.created} registro(s) importado(s).</p>
          {summary.skipped.length > 0 && (
            <>
              <p className="mb-1 font-medium">Ignorados por já existirem ({summary.skipped.length}):</p>
              <ul className="mb-3 max-h-32 overflow-y-auto text-theme-xs text-gray-500">
                {summary.skipped.map((s) => (
                  <li key={s.row}>
                    Linha {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          {summary.errors.length > 0 && (
            <>
              <p className="mb-1 font-medium text-error-700">Com erro ({summary.errors.length}):</p>
              <ul className="mb-3 max-h-32 overflow-y-auto text-theme-xs text-error-600">
                {summary.errors.map((e) => (
                  <li key={e.row}>
                    Linha {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex justify-end">
            <TaButton variant="primary" onClick={onClose}>
              Concluir
            </TaButton>
          </div>
        </div>
      ) : !sheet ? (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-6 py-10 text-center hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5">
          <FileSpreadsheet size={32} className="text-success-600" />
          <span className="text-theme-sm font-medium text-gray-700 dark:text-gray-300">Escolha uma planilha Excel (.xlsx) ou CSV</span>
          <span className="text-theme-xs text-gray-500">A primeira linha deve ter os nomes das colunas.</span>
          <input type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
          <ErrorText>{error}</ErrorText>
        </label>
      ) : (
        <>
          <p className="mb-3 text-theme-sm text-gray-600 dark:text-gray-300">
            {sheet.rows.length} linha(s) encontradas. Confira de qual coluna vem cada campo:
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {fields.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-theme-sm">
                <span className="w-32 shrink-0 text-gray-700 dark:text-gray-300">
                  {f.label}
                  {f.required && " *"}
                </span>
                <TaSelect
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => {
                    const next = { ...mapping };
                    if (e.target.value === "") delete next[f.key];
                    else next[f.key] = Number(e.target.value);
                    setMapping(next);
                  }}
                >
                  <option value="">—</option>
                  {sheet.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Coluna ${i + 1}`}
                    </option>
                  ))}
                </TaSelect>
              </label>
            ))}
          </div>
          {customColumns.length > 0 && (
            <p className="mt-3 text-theme-xs text-gray-500">Campos personalizados reconhecidos: {customColumns.map(([h]) => h).join(", ")}.</p>
          )}
          <p className="mt-3 text-theme-xs text-gray-500">Registros que já existem (mesmo e-mail/celular, ou mesmo CNPJ/nome) são ignorados.</p>
          <ErrorText>{error}</ErrorText>
          <div className="mt-5 flex justify-end gap-2">
            <TaButton onClick={() => setSheet(null)}>Outro arquivo</TaButton>
            <TaButton variant="primary" disabled={busy} onClick={() => void run()}>
              {busy ? "Importando…" : `Importar ${sheet.rows.length} linha(s)`}
            </TaButton>
          </div>
        </>
      )}
    </TaModal>
  );
}
