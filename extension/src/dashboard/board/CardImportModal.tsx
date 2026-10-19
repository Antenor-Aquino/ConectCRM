// Importar cartões de uma planilha (Excel/CSV) para o funil aberto (spec 01,
// seção 10.1.2): escolher o arquivo → de-para das colunas (sugerido pelo
// cabeçalho) → de-para dos valores de etapa, situação, responsável e campos
// de opções → importar em lotes → resumo.
import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { TaButton, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { CardImportRow } from "../../db/cardImporter";
import type { CustomField } from "../../db/customFields";
import type { DealStatus } from "../../db/deals";
import type { ImportSummary } from "../../db/importer";
import type { Pipeline, Stage } from "../../db/pipelines";
import { CARD_TEXT, OUTCOME_TEXT } from "../../lib/cardTypes";
import { errorText } from "../../lib/errors";
import { importKey, splitList } from "../../lib/importParse";
import { downloadSpreadsheet, guessMapping, readSpreadsheet } from "../../lib/spreadsheet";
import { useSession } from "../session";
import { ErrorText } from "../ui/form";
import { ImportSummaryView } from "../contacts/ImportModal";

/** Campos personalizados que dá para importar (documento só pelo GED). */
const SKIP_TYPES = new Set<CustomField["field_type"]>(["document"]);
const BATCH = 200;
const MAX_VALUES = 60;
const ME = "__me";
const NONE = "__none";

interface Field {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
  /** Colunas cujos valores passam pelo de-para. */
  values?: "stage" | "status" | "owner" | "options";
  multi?: boolean;
  field?: CustomField;
}

interface Target {
  value: string;
  label: string;
}

const STATUS_ALIASES: Record<DealStatus, string[]> = {
  open: ["aberto", "aberta", "em aberto", "em andamento", "andamento", "ativo", "open", "pendente", "novo"],
  won: ["ganho", "ganha", "vendido", "fechado", "won", "resolvido", "concluido", "concluída", "finalizado", "sucesso"],
  lost: ["perdido", "perdida", "lost", "cancelado", "não resolvido", "nao resolvido", "não concluído", "nao concluido", "recusado"],
};

function baseFields(pipeline: Pipeline): Field[] {
  const text = CARD_TEXT[pipeline.type];
  const kindFields: Field[] =
    pipeline.type === "comercial"
      ? [
          {
            key: "expectedCloseAt",
            label: "Previsão de fechamento",
            aliases: ["previsao de fechamento", "previsao", "data prevista", "fechamento previsto", "close date"],
          },
        ]
      : pipeline.type === "operacional"
        ? [{ key: "slaAt", label: "SLA", aliases: ["sla", "prazo sla", "prazo de atendimento", "vencimento"] }]
        : [
            { key: "startAt", label: "Início", aliases: ["inicio", "data de inicio", "data inicial", "start"] },
            { key: "dueAt", label: "Prazo", aliases: ["prazo", "entrega", "data de entrega", "termino", "data final", "due"] },
          ];
  return [
    {
      key: "title",
      label: text.titleLabel,
      required: true,
      aliases: [text.titleLabel, "nome", "titulo", "negocio", "negociacao", "oportunidade", "ticket", "assunto", "cartao", "name", "title", "deal"],
    },
    { key: "stage", label: text.stageLabel, aliases: ["etapa", "fase", "estagio", "stage", "etapa do funil"], values: "stage" },
    { key: "status", label: "Situação", aliases: ["situacao", "status", "resultado", "desfecho"], values: "status" },
    { key: "value", label: "Valor", aliases: ["valor", "valor total", "valor r$", "preco", "amount", "value"] },
    { key: "owner", label: "Responsável", aliases: ["responsavel", "vendedor", "dono", "owner", "atendente", "usuario"], values: "owner" },
    { key: "personName", label: "Contato", aliases: ["contato", "nome do contato", "cliente", "pessoa", "contact"] },
    { key: "personEmail", label: "E-mail do contato", aliases: ["email", "e-mail", "email do contato", "e-mail do contato"] },
    { key: "personPhone", label: "Celular do contato", aliases: ["celular", "telefone", "whatsapp", "fone", "phone", "celular do contato"] },
    { key: "organizationName", label: "Organização", aliases: ["organizacao", "empresa", "company", "conta"] },
    ...kindFields,
    { key: "origin", label: "Origem", aliases: ["origem", "fonte", "canal", "source"] },
    { key: "tags", label: "Tags", aliases: ["tags", "tag", "etiquetas", "marcadores"] },
    { key: "description", label: "Descrição", aliases: ["descricao", "observacoes", "observacao", "obs", "detalhes", "description"] },
  ];
}

export function CardImportModal({ pipeline, onClose, onImported }: { pipeline: Pipeline; onClose: () => void; onImported: () => void }) {
  const { users } = useSession();
  const kind = CARD_TEXT[pipeline.type].kind;
  const outcome = OUTCOME_TEXT[pipeline.type];
  const [stages, setStages] = useState<Stage[]>([]);
  const [custom, setCustom] = useState<CustomField[]>([]);
  const [sheet, setSheet] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  /** De-para dos valores: campo → valor normalizado da planilha → destino. */
  const [valueMap, setValueMap] = useState<Record<string, Record<string, string>>>({});
  const [defaultStageId, setDefaultStageId] = useState("");
  const [skipExisting, setSkipExisting] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([call("stages.list", { pipelineId: pipeline.id }), call("customFields.list", { entity: kind, pipelineId: pipeline.id })]).then(
      ([s, f]) => {
        setStages(s);
        setDefaultStageId(s[0]?.id ?? "");
        setCustom(f.filter((x) => !SKIP_TYPES.has(x.field_type)));
      },
    );
  }, [pipeline.id, kind]);

  const fields = useMemo<Field[]>(
    () => [
      ...baseFields(pipeline),
      ...custom.map<Field>((f) => ({
        key: `cf:${f.id}`,
        label: f.name,
        required: !!f.required && !f.hidden,
        aliases: [f.name],
        field: f,
        values: f.field_type === "select" || f.field_type === "multiselect" ? "options" : undefined,
        multi: f.field_type === "multiselect",
      })),
    ],
    [pipeline, custom],
  );

  const targetsOf = (f: Field): Target[] => {
    if (f.values === "stage") return stages.map((s) => ({ value: s.id, label: s.name }));
    if (f.values === "status")
      return [
        { value: "open", label: "Aberto" },
        { value: "won", label: outcome.won },
        { value: "lost", label: outcome.lost },
      ];
    if (f.values === "owner")
      return [{ value: ME, label: "Quem importa (eu)" }, { value: NONE, label: "Sem responsável" }, ...users.map((u) => ({ value: u.id, label: u.name }))];
    return f.field?.options.map((o) => ({ value: o.id, label: o.label })) ?? [];
  };

  /** Sugestão do destino de um valor da planilha (pelo nome). */
  const guessTarget = (f: Field, raw: string): string => {
    const k = importKey(raw);
    if (f.values === "status") {
      const hit = (Object.keys(STATUS_ALIASES) as DealStatus[]).find((s) =>
        [...STATUS_ALIASES[s], s === "won" ? outcome.won : s === "lost" ? outcome.lost : "aberto"].some((a) => importKey(a) === k),
      );
      return hit ?? "";
    }
    if (f.values === "owner") {
      const u = users.find((x) => importKey(x.name) === k || (x.email && importKey(x.email) === k));
      return u?.id ?? "";
    }
    return targetsOf(f).find((t) => importKey(t.label) === k)?.value ?? "";
  };

  /** Valores distintos de uma coluna (para o de-para), com quantas linhas têm cada um. */
  const distinct = (f: Field): { raw: string; key: string; count: number }[] => {
    const col = mapping[f.key];
    if (!sheet || col === undefined) return [];
    const out = new Map<string, { raw: string; key: string; count: number }>();
    for (const r of sheet.rows) {
      for (const raw of f.multi ? splitList(r[col]) : [r[col] ?? ""]) {
        const key = importKey(raw);
        if (!key) continue;
        const cur = out.get(key);
        if (cur) cur.count++;
        else out.set(key, { raw: raw.trim(), key, count: 1 });
      }
    }
    return [...out.values()];
  };

  /** Ao (re)escolher a coluna, sugere o destino de cada valor ainda sem de-para. */
  function suggestValues(nextMapping: Record<string, number>, base = valueMap) {
    const next = { ...base };
    for (const f of fields) {
      if (!f.values || nextMapping[f.key] === undefined || !sheet) continue;
      const cur = { ...(next[f.key] ?? {}) };
      const col = nextMapping[f.key]!;
      for (const r of sheet.rows)
        for (const raw of f.multi ? splitList(r[col]) : [r[col] ?? ""]) {
          const key = importKey(raw);
          if (key && cur[key] === undefined) cur[key] = guessTarget(f, raw);
        }
      next[f.key] = cur;
    }
    setValueMap(next);
  }

  useEffect(() => {
    if (sheet) suggestValues(mapping, {});
    // Sugere de novo quando chegam etapas/usuários/campos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, stages, custom]);

  async function pick(file: File) {
    setError(null);
    try {
      const s = await readSpreadsheet(file);
      if (s.rows.length === 0) throw new Error("A planilha não tem linhas.");
      setMapping(guessMapping(s.headers, fields));
      setValueMap({});
      setSheet(s);
    } catch (e) {
      setError(errorText(e));
    }
  }

  function setColumn(key: string, value: string) {
    const next = { ...mapping };
    if (value === "") delete next[key];
    else next[key] = Number(value);
    setMapping(next);
    suggestValues(next);
  }

  function buildRow(r: string[]): CardImportRow {
    const row: CardImportRow = {};
    const cell = (key: string) => (mapping[key] === undefined ? undefined : (r[mapping[key]!] ?? ""));
    const mapped = (key: string) => {
      const raw = cell(key);
      return raw === undefined ? undefined : (valueMap[key]?.[importKey(raw)] ?? "");
    };
    for (const f of fields) {
      const raw = cell(f.key);
      if (raw === undefined) continue;
      if (f.key === "stage") row.stageId = mapped("stage") || undefined;
      else if (f.key === "status") row.status = (mapped("status") || "open") as DealStatus;
      else if (f.key === "owner") {
        const v = importKey(raw) ? mapped("owner") || ME : ME;
        row.ownerId = v === ME ? undefined : v === NONE ? null : v;
      } else if (f.field) {
        row.custom ??= {};
        if (f.values === "options") {
          const ids = (f.multi ? splitList(raw) : [raw]).map((v) => valueMap[f.key]?.[importKey(v)] ?? "").filter(Boolean);
          if (ids.length) row.custom[f.field.id] = f.multi ? ids : ids[0]!;
        } else row.custom[f.field.id] = raw;
      } else (row as Record<string, unknown>)[f.key] = raw;
    }
    return row;
  }

  async function run() {
    if (!sheet) return;
    const missing = fields.filter((f) => f.required && mapping[f.key] === undefined);
    if (missing.length) return setError(`Escolha a coluna de: ${missing.map((f) => f.label).join(", ")}.`);
    setError(null);
    const total: ImportSummary = { created: 0, skipped: [], errors: [] };
    try {
      for (let i = 0; i < sheet.rows.length; i += BATCH) {
        setProgress({ done: i, total: sheet.rows.length });
        const part = await call("cards.import", {
          pipelineId: pipeline.id,
          defaultStageId,
          skipExisting,
          firstLine: i + 2,
          rows: sheet.rows.slice(i, i + BATCH).map(buildRow),
        });
        total.created += part.created;
        total.skipped.push(...part.skipped);
        total.errors.push(...part.errors);
      }
      setSummary(total);
      if (total.created) onImported();
    } catch (e) {
      setError(errorText(e));
      if (total.created) onImported();
    } finally {
      setProgress(null);
    }
  }

  function downloadTemplate() {
    const headers = fields.map((f) => f.label);
    const example = fields.map((f) =>
      f.key === "title"
        ? CARD_TEXT[pipeline.type].titlePlaceholder.replace(/^Ex[.:]+\s*/, "")
        : f.key === "stage"
          ? (stages[0]?.name ?? "")
          : f.key === "status"
            ? "Aberto"
            : f.key === "value"
              ? "1.500,00"
              : ["expectedCloseAt", "slaAt", "startAt", "dueAt"].includes(f.key)
                ? "31/12/2026"
                : "",
    );
    downloadSpreadsheet(`modelo-importacao-${importKey(pipeline.name) || "funil"}.xlsx`, pipeline.name, headers, [example]);
  }

  const valueFields = fields.filter((f) => f.values && mapping[f.key] !== undefined);
  const firstRow = sheet?.rows[0];

  return (
    <TaModal isOpen onClose={onClose} title={`Importar planilha em ${pipeline.name}`} width="max-w-3xl">
      {summary ? (
        <ImportSummaryView summary={summary} onClose={onClose} />
      ) : !sheet ? (
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-6 py-10 text-center hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5">
            <FileSpreadsheet size={32} className="text-success-600" />
            <span className="text-theme-sm font-medium text-gray-700 dark:text-gray-300">Escolha uma planilha Excel (.xlsx) ou CSV</span>
            <span className="text-theme-xs text-gray-500">
              A primeira linha deve ter os nomes das colunas. Na próxima tela você confere de qual coluna vem cada campo e para qual etapa vai cada valor.
            </span>
            <input type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
          </label>
          <ErrorText>{error}</ErrorText>
          <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-theme-sm text-brand-600 hover:underline">
            <Download size={14} /> Baixar planilha modelo deste funil
          </button>
        </div>
      ) : (
        <>
          <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1 custom-scrollbar">
            <section>
              <p className="mb-2 text-theme-sm text-gray-600 dark:text-gray-300">
                <b>1. De-para das colunas.</b> {sheet.rows.length} linha(s) encontradas. Confira de qual coluna vem cada campo:
              </p>
              <div className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
                {fields.map((f) => {
                  const col = mapping[f.key];
                  const sample = col !== undefined ? firstRow?.[col] : undefined;
                  return (
                    <label key={f.key} className="flex items-center gap-2 text-theme-sm" data-import-field={f.key}>
                      <span className="w-36 shrink-0 truncate text-gray-700 dark:text-gray-300" title={f.label}>
                        {f.label}
                        {f.required && <span className="text-error-500"> *</span>}
                      </span>
                      <span className="min-w-0 flex-1">
                        <TaSelect value={col ?? ""} onChange={(e) => setColumn(f.key, e.target.value)}>
                          <option value="">— não importar —</option>
                          {sheet.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h || `Coluna ${i + 1}`}
                            </option>
                          ))}
                        </TaSelect>
                        {sample ? <span className="mt-0.5 block truncate text-[11px] text-gray-400">ex.: {sample}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section>
              <p className="mb-2 text-theme-sm text-gray-600 dark:text-gray-300">
                <b>2. De-para dos valores.</b> Para onde vai cada valor da planilha:
              </p>
              <label className="mb-3 flex items-center gap-2 text-theme-sm">
                <span className="w-56 shrink-0 text-gray-700 dark:text-gray-300">
                  {CARD_TEXT[pipeline.type].stageLabel} para linhas sem etapa ou não reconhecidas
                </span>
                <TaSelect value={defaultStageId} onChange={(e) => setDefaultStageId(e.target.value)} data-default-stage>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </TaSelect>
              </label>
              {valueFields.length === 0 && (
                <p className="text-theme-xs text-gray-500">Nenhuma coluna de etapa, situação, responsável ou campo de opções escolhida.</p>
              )}
              {valueFields.map((f) => {
                const values = distinct(f);
                const targets = targetsOf(f);
                const fallback =
                  f.values === "stage"
                    ? `${stages.find((s) => s.id === defaultStageId)?.name ?? "primeira etapa"} (padrão)`
                    : f.values === "status"
                      ? "Aberto (padrão)"
                      : f.values === "owner"
                        ? "Quem importa (padrão)"
                        : "Deixar vazio";
                return (
                  <div key={f.key} className="mb-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700" data-value-map={f.key}>
                    <p className="mb-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {f.label} <span className="font-normal text-gray-400">· coluna “{sheet.headers[mapping[f.key]!]}”</span>
                    </p>
                    {values.length === 0 && <p className="text-theme-xs text-gray-500">A coluna está vazia.</p>}
                    <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
                      {values.slice(0, MAX_VALUES).map((v) => {
                        const target = valueMap[f.key]?.[v.key] ?? "";
                        return (
                          <label key={v.key} className="flex items-center gap-2 text-theme-sm" data-value={v.raw}>
                            <span className="w-36 shrink-0 truncate text-gray-700 dark:text-gray-300" title={`${v.raw} (${v.count} linha(s))`}>
                              {v.raw} <span className="text-theme-xs text-gray-400">({v.count})</span>
                            </span>
                            <span className="text-gray-400">→</span>
                            <TaSelect
                              value={target}
                              onChange={(e) => setValueMap({ ...valueMap, [f.key]: { ...valueMap[f.key], [v.key]: e.target.value } })}
                              className={cn(!target && "border-warning-300 bg-warning-50/40")}
                            >
                              <option value="">{fallback}</option>
                              {targets.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </TaSelect>
                          </label>
                        );
                      })}
                    </div>
                    {values.length > MAX_VALUES && (
                      <p className="mt-2 text-theme-xs text-warning-700">
                        A coluna tem {values.length} valores diferentes; mostrando {MAX_VALUES}. Os demais vão para “{fallback}”. Confira se a coluna escolhida
                        é a certa.
                      </p>
                    )}
                  </div>
                );
              })}
            </section>

            <section className="space-y-1 text-theme-xs text-gray-500">
              <label className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
                Ignorar linhas cujo nome já existe neste funil
              </label>
              <p>Contatos são achados pelo e-mail, celular ou nome; organizações, pelo nome. Os que não existem são criados.</p>
              <p>Tags que não existem são criadas. Datas em dd/mm/aaaa e valores como 1.500,00 ou R$ 1.500,00.</p>
            </section>
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="mt-5 flex items-center justify-end gap-2">
            {progress && (
              <span className="mr-auto text-theme-sm text-gray-500">
                Importando {Math.min(progress.done + BATCH, progress.total)} de {progress.total}…
              </span>
            )}
            <TaButton onClick={() => setSheet(null)} disabled={!!progress}>
              Outro arquivo
            </TaButton>
            <TaButton variant="primary" disabled={!!progress || !stages.length} onClick={() => void run()}>
              {progress ? "Importando…" : `Importar ${sheet.rows.length} linha(s)`}
            </TaButton>
          </div>
        </>
      )}
    </TaModal>
  );
}
