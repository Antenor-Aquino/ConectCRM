// Importar do Pipedrive (spec 09): abas Leads / Contatos / Organizações →
// buscar pelo nome ou pela data de criação → escolher os registros (novo, já
// importado, possível duplicado) → de-para dos campos e dos valores → importar
// em lotes → resumo. Organizações e contatos ligados aos registros entram
// junto, com o de-para salvo deles (ou o sugerido).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { CustomField } from "../../db/customFields";
import type { ExternalCheckResult, ExternalImportSummary, ExternalNoteRow } from "../../db/externalImport";
import type { Pipeline, Stage } from "../../db/pipelines";
import { errorText } from "../../lib/errors";
import { formatDate } from "../../lib/format";
import { importKey } from "../../lib/importParse";
import { loadPipedriveMappings, savePipedriveMapping, type PipedriveSettings } from "../../lib/integrations";
import { PipedriveClient, type PdEntity, type PdPipeline, type PdRaw, type PdStage, type PdUser } from "../../lib/pipedrive/api";
import {
  buildRow,
  CRM_ENTITY,
  crmTargets,
  guessFieldMapping,
  guessOption,
  noteRows,
  orgIdOf,
  OWNER_ME,
  OWNER_NONE,
  ownerIdOf,
  personIdOf,
  sourceFields,
  summarize,
  type CrmTarget,
  type PdMapping,
  type PdMeta,
  type PdRow,
  type PdSummary,
  type SourceField,
} from "../../lib/pipedrive/records";
import { ImportSummaryView } from "../contacts/ImportModal";
import { useSession } from "../session";
import { ErrorText } from "../ui/form";

const TABS: { id: PdEntity; label: string; noun: string }[] = [
  { id: "lead", label: "Leads", noun: "lead(s)" },
  { id: "deal", label: "Negócios", noun: "negócio(s)" },
  { id: "person", label: "Contatos", noun: "contato(s)" },
  { id: "organization", label: "Organizações", noun: "organização(ões)" },
];
const IMPORT_METHOD = {
  person: "integrations.importPersons",
  organization: "integrations.importOrganizations",
  lead: "integrations.importDeals",
  deal: "integrations.importDeals",
} as const;
/** Leads e negócios viram cartões; trazem contato e organização junto. */
const isCard = (e: PdEntity) => e === "lead" || e === "deal";
const NOTE_BATCH = 200;
const BATCH = 100;
const MATCH_LABEL = { email: "e-mail", phone: "celular", cnpj: "CNPJ", name: "nome" } as const;

interface Info {
  meta: PdMeta;
  sources: SourceField[];
  targets: CrmTarget[];
}
interface Result {
  raw: PdRaw;
  sum: PdSummary;
}
type DupChoice = "link" | "update" | "new";

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function PipedriveImportModal({ settings, onClose }: { settings: PipedriveSettings; onClose: () => void }) {
  const { users: crmUsers } = useSession();
  const client = useMemo(() => new PipedriveClient(settings.token), [settings.token]);
  const [tab, setTab] = useState<PdEntity>("lead");
  const [step, setStep] = useState<"search" | "map" | "done">("search");
  const [mode, setMode] = useState<"name" | "date">("name");
  const [term, setTerm] = useState("");
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ExternalCheckResult>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<Record<string, DupChoice>>({});
  const [mapping, setMapping] = useState<PdMapping | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [summary, setSummary] = useState<{ main: ExternalImportSummary; related: string[] } | null>(null);

  // Caches da sessão da janela: metadados por tipo, usuários e registros relacionados.
  const pdUsers = useRef<PdUser[] | null>(null);
  const infos = useRef(new Map<PdEntity, Info>());
  // Negócios: funis e etapas do Pipedrive.
  const pdStages = useRef<{ pipelines: PdPipeline[]; stages: PdStage[] } | null>(null);
  // Etapas de todos os funis comerciais do CRM (de-para das etapas).
  const [crmStages, setCrmStages] = useState<{ pipeline: Pipeline; stages: Stage[] }[]>([]);
  const related = useRef(new Map<string, PdRaw>()); // `${tipo}:${id}`

  const reset = () => {
    setStep("search");
    setResults(null);
    setStatuses({});
    setSelected(new Set());
    setChoice({});
    setMapping(null);
    setSummary(null);
    setError(null);
    setInfo(null);
    setTruncated(false);
  };

  async function ensure(entity: PdEntity): Promise<Info> {
    const cached = infos.current.get(entity);
    if (cached) return cached;
    pdUsers.current ??= await client.users();
    const [fields, leadLabels, crmFields] = await Promise.all([
      client.fields(entity),
      entity === "lead" ? client.leadLabels() : Promise.resolve(undefined),
      call("customFields.list", { entity: CRM_ENTITY[entity] }) as Promise<CustomField[]>,
    ]);
    const meta: PdMeta = { fields, users: pdUsers.current, leadLabels };
    const out = { meta, sources: sourceFields(entity, meta), targets: crmTargets(CRM_ENTITY[entity], crmFields) };
    infos.current.set(entity, out);
    return out;
  }

  /** Registros relacionados (organizações/contatos), buscados uma vez. */
  async function relatedRaws(entity: "person" | "organization", ids: (string | undefined)[]): Promise<PdRaw[]> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const missing = want.filter((id) => !related.current.has(`${entity}:${id}`));
    if (missing.length) {
      setBusy(`Buscando ${entity === "person" ? "contatos" : "organizações"} relacionados…`);
      for (const r of await client.getMany(entity, missing)) related.current.set(`${entity}:${String(r.id)}`, r);
    }
    return want.map((id) => related.current.get(`${entity}:${id}`)).filter((x): x is PdRaw => !!x);
  }

  async function check(entity: PdEntity, sums: PdSummary[]): Promise<Record<string, ExternalCheckResult>> {
    const out: Record<string, ExternalCheckResult> = {};
    for (let i = 0; i < sums.length; i += 500) {
      const part = sums.slice(i, i + 500);
      const res = await call("integrations.check", {
        provider: "pipedrive",
        entity: CRM_ENTITY[entity],
        items: part.map((s) => ({ externalId: s.id, name: s.name, email: s.email, phone: s.phone, cnpj: s.cnpj, updatedAt: s.updateTime })),
      });
      for (const r of res) out[r.externalId] = r;
    }
    return out;
  }

  async function search() {
    if (mode === "name" && term.trim().length < 2) return setError("Digite pelo menos 2 letras do nome.");
    setError(null);
    setBusy("Buscando no Pipedrive…");
    try {
      const inf = await ensure(tab);
      setInfo(inf);
      if (tab === "deal" && !pdStages.current) {
        const [pipelines, stages] = await Promise.all([client.pipelines(), client.stages()]);
        pdStages.current = { pipelines, stages };
      }
      let raws: PdRaw[];
      if (mode === "name") {
        raws = await client.search(tab, term);
        setTruncated(false);
      } else {
        const r = await client.listCreated(tab, from, to, { onProgress: (n) => setBusy(`Lendo o Pipedrive… ${n} registro(s) verificados`) });
        raws = r.items;
        setTruncated(r.truncated);
      }
      const list = raws.map((raw) => ({ raw, sum: summarize(tab, raw, inf.sources) }));
      // Nomes da organização/contato para a lista (os mesmos registros entram na importação).
      if (tab !== "organization")
        await relatedRaws(
          "organization",
          list.map((r) => r.sum.orgId),
        );
      if (isCard(tab))
        await relatedRaws(
          "person",
          list.map((r) => r.sum.personId),
        );
      setBusy("Conferindo o que já está no CRM…");
      const st = await check(
        tab,
        list.map((r) => r.sum),
      );
      setStatuses(st);
      setResults(list);
      setSelected(new Set(list.filter((r) => st[r.sum.id]?.status !== "imported").map((r) => r.sum.id)));
      setChoice({});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  /** De-para salvo (ou sugerido) de um tipo, completando campos novos. */
  async function mappingFor(entity: PdEntity, inf: Info, raws: PdRaw[]): Promise<PdMapping> {
    const saved = (await loadPipedriveMappings<PdMapping>())[entity];
    const guessed = guessFieldMapping(entity, inf.sources, inf.targets);
    const fields: Record<string, string> = { ...guessed, ...(saved?.fields ?? {}) };
    // Um destino só uma vez (o salvo vence).
    const seen = new Set<string>();
    for (const [k, v] of Object.entries(fields)) {
      if (!v) continue;
      if (seen.has(v) && !(saved?.fields && k in saved.fields)) fields[k] = "";
      seen.add(v);
    }
    const owners: Record<string, string> = { ...(saved?.owners ?? {}) };
    for (const id of new Set(raws.map(ownerIdOf).filter((x): x is string => !!x))) {
      if (owners[id]) continue;
      const u = pdUsers.current?.find((x) => String(x.id) === id);
      const crm = u && crmUsers.find((c) => (c.email && importKey(c.email) === importKey(u.email)) || importKey(c.name) === importKey(u.name));
      owners[id] = crm?.id ?? OWNER_ME;
    }
    const options: Record<string, Record<string, string>> = {};
    for (const [src, tgtKey] of Object.entries(fields)) {
      const tgt = inf.targets.find((t) => t.key === tgtKey);
      if (!tgt?.field || !["select", "multiselect"].includes(tgt.field.field_type)) continue;
      const s = inf.sources.find((x) => x.key === src)!;
      const m: Record<string, string> = { ...(saved?.options?.[tgtKey] ?? {}) };
      for (const raw of raws) for (const v of s.get(raw)) if (m[importKey(v)] === undefined) m[importKey(v)] = guessOption(tgt, v);
      options[tgtKey] = m;
    }
    return {
      fields,
      owners,
      options,
      pipelineId: saved?.pipelineId,
      stageId: saved?.stageId,
      stages: { ...(saved?.stages ?? {}) },
      notes: saved?.notes ?? true,
    };
  }

  async function goMap() {
    if (!info || !results) return;
    setError(null);
    const raws = results.filter((r) => selected.has(r.sum.id)).map((r) => r.raw);
    const m = await mappingFor(tab, info, raws);
    if (isCard(tab)) {
      const all = (await call("pipelines.list", {})).filter((p) => p.type === "comercial" && !p.archived_at);
      setPipelines(all);
      if (!m.pipelineId || !all.some((p) => p.id === m.pipelineId)) m.pipelineId = all[0]?.id;
    }
    if (tab === "deal") {
      // De-para das etapas: sugestão pelo nome (funil de mesmo nome primeiro).
      const groups = await Promise.all(
        (await call("pipelines.list", {}))
          .filter((p) => p.type === "comercial" && !p.archived_at)
          .map(async (pipeline) => ({ pipeline, stages: await call("stages.list", { pipelineId: pipeline.id }) })),
      );
      setCrmStages(groups);
      const stagesMap = { ...(m.stages ?? {}) };
      for (const st of usedPdStages(raws)) {
        const valid = groups.some((g) => g.stages.some((x) => x.id === stagesMap[st.id]));
        if (valid) continue;
        const pdPipe = pdStages.current?.pipelines.find((p) => p.id === st.pipeline_id)?.name ?? "";
        const same = groups.find((g) => importKey(g.pipeline.name) === importKey(pdPipe));
        const hit =
          same?.stages.find((x) => importKey(x.name) === importKey(st.name)) ??
          groups.flatMap((g) => g.stages).find((x) => importKey(x.name) === importKey(st.name));
        stagesMap[String(st.id)] = hit?.id ?? "";
      }
      m.stages = stagesMap;
    }
    setMapping(m);
    setStep("map");
  }

  useEffect(() => {
    if (tab !== "lead" || !mapping?.pipelineId) return;
    void call("stages.list", { pipelineId: mapping.pipelineId }).then((s) => {
      setStages(s);
      if (!s.some((x) => x.id === mapping.stageId)) setMapping((m) => (m ? { ...m, stageId: s[0]?.id } : m));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mapping?.pipelineId]);

  /** Etapas do Pipedrive usadas pelos negócios escolhidos (na ordem do funil). */
  function usedPdStages(raws: PdRaw[]): PdStage[] {
    const ids = new Set(raws.map((r) => String(r.stage_id ?? "")));
    return (pdStages.current?.stages ?? [])
      .filter((s) => ids.has(String(s.id)))
      .sort((a, b) => a.pipeline_id - b.pipeline_id || (a.order_nr ?? 0) - (b.order_nr ?? 0));
  }

  /** Notas dos registros importados (uma chamada por registro). */
  async function importNotes(entity: PdEntity, ids: string[], notes: string[]) {
    let rows: ExternalNoteRow[] = [];
    let created = 0;
    const flush = async () => {
      if (!rows.length) return;
      const r = await call("integrations.importNotes", { provider: "pipedrive", rows });
      created += r.created;
      for (const e of r.errors) notes.push(`nota: ${e}`);
      rows = [];
    };
    for (let i = 0; i < ids.length; i++) {
      setBusy(`Buscando as notas… ${i + 1} de ${ids.length}`);
      rows.push(...noteRows(entity, ids[i]!, await client.notes(entity, ids[i]!), pdUsers.current ?? []));
      if (rows.length >= NOTE_BATCH) await flush();
    }
    await flush();
    if (created) notes.push(`${created} nota(s) importada(s)`);
  }

  /** Importa os relacionados que ainda não estão no CRM (novos são criados; duplicados, vinculados). */
  async function importRelated(entity: "person" | "organization", raws: PdRaw[], notes: string[]) {
    if (!raws.length) return;
    const inf = await ensure(entity);
    const m = await mappingFor(entity, inf, raws);
    const st = await check(
      entity,
      raws.map((r) => summarize(entity, r, inf.sources)),
    );
    const rows: PdRow[] = [];
    for (const raw of raws) {
      const s = st[String(raw.id)];
      if (!s || s.status === "imported") continue;
      const row = buildRow(entity, raw, inf.sources, inf.targets, m);
      rows.push(s.status === "duplicate" ? { ...row, localId: s.localId, update: false } : row);
    }
    if (!rows.length) return;
    setBusy(`Importando ${rows.length} ${entity === "person" ? "contato(s)" : "organização(ões)"} relacionados…`);
    const r = await call(IMPORT_METHOD[entity], { provider: "pipedrive", rows });
    const what = entity === "person" ? "contato(s)" : "organização(ões)";
    if (r.created) notes.push(`${r.created} ${what} criados junto`);
    if (r.linked) notes.push(`${r.linked} ${what} vinculados a cadastros existentes`);
    for (const e of r.errors) notes.push(`${what}: ${e.message}`);
  }

  async function run() {
    if (!info || !results || !mapping) return;
    if (tab === "lead" && (!mapping.pipelineId || !mapping.stageId)) return setError("Escolha o funil e a etapa de destino dos leads.");
    if (tab === "deal") {
      const chosenRaws = results.filter((r) => selected.has(r.sum.id)).map((r) => r.raw);
      const missing = usedPdStages(chosenRaws).filter((st) => !mapping.stages?.[String(st.id)]);
      if (missing.length) return setError(`Escolha a etapa do CRM para: ${missing.map((st) => st.name).join(", ")}.`);
    }
    setError(null);
    const chosen = results.filter((r) => selected.has(r.sum.id));
    const notes: string[] = [];
    const total: ExternalImportSummary = { created: 0, updated: 0, linked: 0, skipped: [], errors: [], warnings: [] };
    try {
      // 1. Relacionados: contatos dos leads e organizações (dos leads e desses contatos).
      const persons = isCard(tab)
        ? await relatedRaws(
            "person",
            chosen.map((r) => r.sum.personId),
          )
        : [];
      if (tab !== "organization") {
        const orgs = await relatedRaws("organization", [...chosen.map((r) => orgIdOf(r.raw)), ...persons.map(orgIdOf)]);
        await importRelated("organization", orgs, notes);
      }
      if (isCard(tab)) await importRelated("person", persons, notes);
      // 2. Os escolhidos.
      const rows = chosen.map((r, i): PdRow & { _i: number } => {
        const base = { ...buildRow(tab, r.raw, info.sources, info.targets, mapping), _i: i };
        const s = statuses[r.sum.id];
        if (s?.status === "imported") return { ...base, localId: s.localId, update: true };
        if (s?.status === "duplicate") {
          const c = choice[r.sum.id] ?? "update";
          return c === "new" ? base : { ...base, localId: s.localId, update: c === "update" };
        }
        return base;
      });
      for (let i = 0; i < rows.length; i += BATCH) {
        setBusy(`Importando ${Math.min(i + BATCH, rows.length)} de ${rows.length}…`);
        const part = rows.slice(i, i + BATCH).map(({ _i, ...row }) => row);
        const r = await call(IMPORT_METHOD[tab], {
          provider: "pipedrive",
          rows: part,
          firstRow: i + 1,
          pipelineId: mapping.pipelineId,
          stageId: mapping.stageId,
        });
        total.created += r.created;
        total.updated += r.updated;
        total.linked += r.linked;
        total.skipped.push(...r.skipped);
        total.errors.push(...r.errors);
        total.warnings.push(...r.warnings);
      }
      // 3. Notas dos registros que entraram (ou já estavam) no CRM.
      if (mapping.notes !== false)
        await importNotes(
          tab,
          chosen.map((r) => r.sum.id),
          notes,
        );
      await savePipedriveMapping(tab, mapping);
      setSummary({ main: total, related: notes });
      setStep("done");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const noun = TABS.find((t) => t.id === tab)!.noun;
  return (
    <TaModal isOpen onClose={() => !busy && onClose()} title="Importar do Pipedrive" width="max-w-5xl">
      <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-800" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            disabled={!!busy}
            onClick={() => {
              setTab(t.id);
              reset();
            }}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-theme-sm font-medium",
              tab === t.id ? "border-brand-500 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {step === "done" && summary ? (
        <ImportSummaryView
          summary={summary.main}
          onClose={onClose}
          extra={summary.related.length > 0 && <p className="mb-3 text-theme-xs text-gray-500">Relacionados: {summary.related.join(" · ")}.</p>}
        />
      ) : step === "search" ? (
        searchStep()
      ) : (
        info && mapping && mapStep()
      )}
      {busy && (
        <p className="mt-3 text-theme-sm text-brand-600" data-busy>
          {busy}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
    </TaModal>
  );

  /** "R$ 1.500,00 · Proposta · Ganho" (negócios). */
  function dealDetail(sum: PdSummary): string {
    const stage = pdStages.current?.stages.find((x) => String(x.id) === sum.stageId)?.name;
    const status = sum.status === "won" ? "Ganho" : sum.status === "lost" ? "Perdido" : "";
    return [sum.detail, stage, status].filter(Boolean).join(" · ");
  }

  function searchStep() {
    const all = results ?? [];
    const allOn = all.length > 0 && all.every((r) => selected.has(r.sum.id));
    const relName = (kind: "person" | "organization", id?: string) => (id ? String(related.current.get(`${kind}:${id}`)?.name ?? `#${id}`) : "");
    return (
      <>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="flex rounded-lg border border-gray-200 p-0.5 text-theme-sm dark:border-gray-700" role="group" aria-label="Buscar por">
            {(
              [
                ["name", "Pelo nome"],
                ["date", "Pela data de criação"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-3 py-1.5",
                  mode === m ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "name" ? (
            <div className="min-w-[260px] flex-1">
              <TaInput
                value={term}
                autoFocus
                placeholder={
                  tab === "person"
                    ? "Nome, e-mail ou telefone"
                    : tab === "lead"
                      ? "Título do lead"
                      : tab === "deal"
                        ? "Título do negócio"
                        : "Nome da organização"
                }
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void search()}
                aria-label="Buscar no Pipedrive"
              />
            </div>
          ) : (
            <>
              <label className="text-theme-xs text-gray-500">
                De
                <TaInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Criados a partir de" />
              </label>
              <label className="text-theme-xs text-gray-500">
                Até
                <TaInput type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Criados até" />
              </label>
            </>
          )}
          <TaButton variant="primary" disabled={!!busy} startIcon={<Search size={15} />} onClick={() => void search()}>
            Buscar
          </TaButton>
        </div>

        {results && (
          <>
            {truncated && (
              <p className="mb-2 rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800">
                Muitos registros no período: mostrando os 2.000 mais recentes. Diminua o período para ver os demais.
              </p>
            )}
            {results.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-theme-sm text-gray-500 dark:bg-white/5">Nada encontrado no Pipedrive.</p>
            ) : (
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-gray-200 custom-scrollbar dark:border-gray-800">
                <table className="w-full text-left text-theme-sm">
                  <thead className="sticky top-0 bg-gray-50 text-theme-xs text-gray-500 dark:bg-gray-900">
                    <tr>
                      <th className="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos"
                          checked={allOn}
                          onChange={(e) => setSelected(new Set(e.target.checked ? all.map((r) => r.sum.id) : []))}
                        />
                      </th>
                      <th className="px-2 py-2">{tab === "lead" ? "Lead" : tab === "deal" ? "Negócio" : "Nome"}</th>
                      <th className="px-2 py-2">
                        {tab === "organization" ? "Cidade" : tab === "lead" ? "Valor" : tab === "deal" ? "Valor · etapa" : "E-mail / telefone"}
                      </th>
                      {tab !== "organization" && <th className="px-2 py-2">{isCard(tab) ? "Contato / organização" : "Organização"}</th>}
                      <th className="px-2 py-2">Criado em</th>
                      <th className="px-2 py-2">Situação no CRM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.map(({ sum }) => {
                      const st = statuses[sum.id];
                      const on = selected.has(sum.id);
                      return (
                        <tr key={sum.id} className="border-t border-gray-100 dark:border-gray-800" data-pd-row={sum.name} data-status={st?.status}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar ${sum.name}`}
                              checked={on}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(sum.id);
                                else next.delete(sum.id);
                                setSelected(next);
                              }}
                            />
                          </td>
                          <td className="px-2 py-2 font-medium text-gray-800 dark:text-white/90">{sum.name || `#${sum.id}`}</td>
                          <td className="px-2 py-2 text-gray-600 dark:text-gray-400">{(tab === "deal" ? dealDetail(sum) : sum.detail) || "—"}</td>
                          {tab !== "organization" && (
                            <td className="px-2 py-2 text-gray-600 dark:text-gray-400">
                              {[isCard(tab) ? relName("person", sum.personId) : "", relName("organization", sum.orgId)].filter(Boolean).join(" · ") || "—"}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-2 py-2 text-gray-600 dark:text-gray-400">{formatDate(sum.addTime)}</td>
                          <td className="px-2 py-2">{statusCell(sum.id, st, on)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-theme-sm text-gray-500">
                {selected.size} de {results.length} {noun} selecionado(s)
              </span>
              <TaButton variant="primary" disabled={!selected.size || !!busy} endIcon={<ArrowRight size={15} />} onClick={() => void goMap()}>
                Próximo: de-para
              </TaButton>
            </div>
          </>
        )}
      </>
    );
  }

  function statusCell(id: string, st: ExternalCheckResult | undefined, on: boolean) {
    if (!st || st.status === "new") return <TaBadge color="green" label="Novo" />;
    if (st.status === "imported")
      return (
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <TaBadge color="slate" label="Já importado" />
            {st.changed && <TaBadge color="amber" label="alterado no Pipedrive" />}
          </span>
          <span className="text-theme-xs text-gray-500">{on ? "Será atualizado com os dados do Pipedrive" : "Marque para atualizar"}</span>
        </span>
      );
    return (
      <span className="flex flex-col gap-1">
        <span className="text-theme-xs text-warning-700">
          <TaBadge color="amber" label="Possível duplicado" /> {st.localName} ({MATCH_LABEL[st.match ?? "name"]})
        </span>
        <TaSelect
          value={choice[id] ?? "update"}
          onChange={(e) => setChoice({ ...choice, [id]: e.target.value as DupChoice })}
          className="h-8 py-0 text-theme-xs"
          aria-label="O que fazer com o duplicado"
        >
          <option value="update">Vincular ao existente e atualizar</option>
          <option value="link">Vincular sem alterar o existente</option>
          <option value="new">Criar um novo</option>
        </TaSelect>
      </span>
    );
  }

  function mapStep() {
    const inf = info!;
    const m = mapping!;
    const chosen = (results ?? []).filter((r) => selected.has(r.sum.id)).map((r) => r.raw);
    const sample = (s: SourceField) => {
      for (const raw of chosen) {
        const v = s.get(raw);
        if (v.length) return v.join("; ");
      }
      return "";
    };
    const withValue = inf.sources.filter((s) => sample(s));
    const empty = inf.sources.filter((s) => !sample(s));
    const used = new Map(
      Object.entries(m.fields)
        .filter(([, t]) => t)
        .map(([s, t]) => [t, s]),
    );
    const setField = (src: string, tgt: string) => {
      const fields = { ...m.fields, [src]: tgt };
      const options = { ...m.options };
      const t = inf.targets.find((x) => x.key === tgt);
      if (t?.field && ["select", "multiselect"].includes(t.field.field_type)) {
        const s = inf.sources.find((x) => x.key === src)!;
        const cur = { ...(options[tgt] ?? {}) };
        for (const raw of chosen) for (const v of s.get(raw)) if (cur[importKey(v)] === undefined) cur[importKey(v)] = guessOption(t, v);
        options[tgt] = cur;
      }
      setMapping({ ...m, fields, options });
    };
    const fieldRow = (s: SourceField) => (
      <tr key={s.key} className="border-t border-gray-100 dark:border-gray-800" data-source={s.key}>
        <td className="px-3 py-1.5 text-gray-800 dark:text-white/90">
          {s.label}
          {s.custom && <span className="ml-1.5 text-[10px] uppercase text-gray-400">personalizado</span>}
        </td>
        <td className="max-w-[260px] truncate px-2 py-1.5 text-theme-xs text-gray-500" title={sample(s)}>
          {sample(s) || "—"}
        </td>
        <td className="px-1 text-gray-400">→</td>
        <td className="px-2 py-1.5">
          <TaSelect value={m.fields[s.key] ?? ""} onChange={(e) => setField(s.key, e.target.value)} className="h-9 py-0" aria-label={`Destino de ${s.label}`}>
            <option value="">— não importar —</option>
            {inf.targets.map((t) => {
              const by = used.get(t.key);
              return (
                <option key={t.key} value={t.key} disabled={!!by && by !== s.key}>
                  {t.label}
                  {t.field ? " (personalizado)" : ""}
                  {by && by !== s.key ? " — já usado" : ""}
                </option>
              );
            })}
          </TaSelect>
        </td>
      </tr>
    );
    const owners = [...new Set(chosen.map(ownerIdOf).filter((x): x is string => !!x))];
    const optionTargets = Object.entries(m.fields)
      .map(([src, tgt]) => ({ src: inf.sources.find((s) => s.key === src), tgt: inf.targets.find((t) => t.key === tgt) }))
      .filter((x): x is { src: SourceField; tgt: CrmTarget } => !!x.src && !!x.tgt?.field && ["select", "multiselect"].includes(x.tgt.field.field_type));
    return (
      <>
        <div className="max-h-[58vh] space-y-5 overflow-y-auto pr-1 custom-scrollbar">
          <section>
            <p className="mb-2 text-theme-sm text-gray-600 dark:text-gray-300">
              <b>1. De-para dos campos.</b> Para onde vai cada informação do Pipedrive ({chosen.length} {noun}). O exemplo é do primeiro registro com valor.
            </p>
            <table className="w-full text-left text-theme-sm">
              <thead className="text-theme-xs text-gray-500">
                <tr>
                  <th className="px-3 py-1">Campo no Pipedrive</th>
                  <th className="px-2 py-1">Exemplo</th>
                  <th />
                  <th className="px-2 py-1">Campo no ConectCRM</th>
                </tr>
              </thead>
              <tbody>
                {withValue.map(fieldRow)}
                {showEmpty && empty.map(fieldRow)}
              </tbody>
            </table>
            {empty.length > 0 && (
              <button type="button" className="mt-1 text-theme-xs text-brand-600 hover:underline" onClick={() => setShowEmpty((v) => !v)}>
                {showEmpty ? "Esconder" : "Mostrar"} campos sem valor nos selecionados ({empty.length})
              </button>
            )}
          </section>

          {(owners.length > 0 && m.fields.owner === "owner") || optionTargets.length > 0 ? (
            <section>
              <p className="mb-2 text-theme-sm text-gray-600 dark:text-gray-300">
                <b>2. De-para dos valores.</b>
              </p>
              {owners.length > 0 && m.fields.owner === "owner" && (
                <div className="mb-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700" data-value-map="owner">
                  <p className="mb-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">Responsável</p>
                  <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                    {owners.map((id) => (
                      <label key={id} className="flex items-center gap-2 text-theme-sm" data-value={pdUsers.current?.find((u) => String(u.id) === id)?.name}>
                        <span className="w-40 shrink-0 truncate">{pdUsers.current?.find((u) => String(u.id) === id)?.name ?? `#${id}`}</span>
                        <span className="text-gray-400">→</span>
                        <TaSelect
                          value={m.owners[id] ?? OWNER_ME}
                          onChange={(e) => setMapping({ ...m, owners: { ...m.owners, [id]: e.target.value } })}
                          className="h-9 py-0"
                        >
                          <option value={OWNER_ME}>Quem importa (eu)</option>
                          <option value={OWNER_NONE}>Sem responsável</option>
                          {crmUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </TaSelect>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {optionTargets.map(({ src, tgt }) => {
                const values = [...new Map(chosen.flatMap((raw) => src.get(raw)).map((v) => [importKey(v), v])).entries()];
                return (
                  <div key={tgt.key} className="mb-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700" data-value-map={tgt.key}>
                    <p className="mb-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {tgt.label} <span className="font-normal text-gray-400">· de “{src.label}”</span>
                    </p>
                    <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                      {values.map(([k, label]) => {
                        const cur = m.options[tgt.key]?.[k] ?? "";
                        return (
                          <label key={k} className="flex items-center gap-2 text-theme-sm" data-value={label}>
                            <span className="w-40 shrink-0 truncate">{label}</span>
                            <span className="text-gray-400">→</span>
                            <TaSelect
                              value={cur}
                              onChange={(e) => setMapping({ ...m, options: { ...m.options, [tgt.key]: { ...m.options[tgt.key], [k]: e.target.value } } })}
                              className={cn("h-9 py-0", !cur && "border-warning-300 bg-warning-50/40")}
                            >
                              <option value="">Deixar vazio</option>
                              {tgt.field!.options.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                            </TaSelect>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}

          {tab === "lead" && (
            <section>
              <p className="mb-2 text-theme-sm text-gray-600 dark:text-gray-300">
                <b>3. Destino dos leads.</b> Cada lead vira um cartão no funil comercial escolhido.
              </p>
              {pipelines.length === 0 ? (
                <p className="text-theme-sm text-error-600">Crie um funil comercial antes de importar leads.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <label className="text-theme-xs text-gray-500">
                    Funil
                    <TaSelect
                      value={m.pipelineId ?? ""}
                      onChange={(e) => setMapping({ ...m, pipelineId: e.target.value, stageId: undefined })}
                      aria-label="Funil de destino"
                    >
                      {pipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </TaSelect>
                  </label>
                  <label className="text-theme-xs text-gray-500">
                    Etapa
                    <TaSelect value={m.stageId ?? ""} onChange={(e) => setMapping({ ...m, stageId: e.target.value })} aria-label="Etapa de destino">
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </TaSelect>
                  </label>
                </div>
              )}
            </section>
          )}

          {tab === "deal" && (
            <section data-stage-map>
              <p className="mb-2 text-theme-sm text-gray-600 dark:text-gray-300">
                <b>3. De-para das etapas.</b> Cada negócio vira um cartão no funil comercial da etapa escolhida. Ganhos e perdidos mantêm a situação, o motivo
                da perda e as datas do Pipedrive.
              </p>
              {crmStages.length === 0 ? (
                <p className="text-theme-sm text-error-600">Crie um funil comercial antes de importar negócios.</p>
              ) : (
                <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                  {usedPdStages(chosen).map((st) => {
                    const cur = m.stages?.[String(st.id)] ?? "";
                    const pipe = pdStages.current?.pipelines.find((p) => p.id === st.pipeline_id)?.name;
                    const count = chosen.filter((r) => String(r.stage_id) === String(st.id)).length;
                    return (
                      <label key={st.id} className="flex items-center gap-2 text-theme-sm" data-value={st.name}>
                        <span className="w-48 shrink-0 truncate" title={`${pipe} › ${st.name}`}>
                          <span className="text-gray-400">{pipe} › </span>
                          {st.name} <span className="text-theme-xs text-gray-400">({count})</span>
                        </span>
                        <span className="text-gray-400">→</span>
                        <TaSelect
                          value={cur}
                          onChange={(e) => {
                            setError(null);
                            setMapping({ ...m, stages: { ...m.stages, [String(st.id)]: e.target.value } });
                          }}
                          className={cn("h-9 py-0", !cur && "border-warning-300 bg-warning-50/40")}
                          aria-label={`Etapa do CRM para ${st.name}`}
                        >
                          <option value="">Escolha a etapa…</option>
                          {crmStages.map((g) => (
                            <optgroup key={g.pipeline.id} label={g.pipeline.name}>
                              {g.stages.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {g.pipeline.name} › {x.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </TaSelect>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <label className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={m.notes !== false} onChange={(e) => setMapping({ ...m, notes: e.target.checked })} />
            Importar também as notas (as já trazidas não se repetem)
          </label>

          <p className="text-theme-xs text-gray-500">
            {isCard(tab)
              ? `O contato e a organização de cada ${tab === "lead" ? "lead" : "negócio"} que ainda não estão no CRM são importados junto e vinculados ao cartão.`
              : tab === "person"
                ? "A organização de cada contato que ainda não está no CRM é importada junto e vinculada."
                : "Organizações já importadas e marcadas são atualizadas com os dados do Pipedrive."}{" "}
            Campos vazios no Pipedrive não apagam o que já existe no CRM. O de-para fica salvo para a próxima vez.
          </p>
        </div>
        <div className="mt-4 flex justify-between gap-2">
          <TaButton startIcon={<ArrowLeft size={15} />} disabled={!!busy} onClick={() => setStep("search")}>
            Voltar
          </TaButton>
          <TaButton variant="primary" disabled={!!busy || (isCard(tab) && !pipelines.length)} onClick={() => void run()}>
            {busy ? "Importando…" : `Importar ${chosen.length} ${noun}`}
          </TaButton>
        </div>
      </>
    );
  }
}
