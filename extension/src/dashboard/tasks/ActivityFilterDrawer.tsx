// Filtros avançados das Atividades: gaveta lateral no mesmo estilo dos filtros
// da Gestão Financeira. Filtra pelo tipo de funil, pelos funis e por um cartão.
// Os campos são um rascunho até "Aplicar filtros".
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Filter, GitBranch, Layers, SquareKanban, Tag as TagIcon } from "lucide-react";
import { TaButton, TaDrawer, TaSelect, badgePalette, cn, type BadgeColor } from "@tailadmin";
import type { Tag } from "../../db/tags";
import { call } from "../../rpc/client";
import type { Pipeline, PipelineType } from "../../db/pipelines";
import { PIPELINE_TYPE_LABEL } from "../../lib/cardTypes";
import { Combobox, type ComboItem } from "../ui/Combobox";

export interface ActivityAdvancedFilter {
  pipelineType: PipelineType | "";
  pipelineIds: string[];
  /** Cartão escolhido (id + rótulo, para mostrar no botão). */
  card: ComboItem | null;
  /** Etiquetas (da atividade ou do cartão dela); `tagNames` só para o resumo. */
  tagIds: string[];
  tagNames?: string[];
}

export const EMPTY_ADVANCED_FILTER: ActivityAdvancedFilter = { pipelineType: "", pipelineIds: [], card: null, tagIds: [] };

/** Quantos filtros avançados estão ligados (para o número no botão). */
export const advancedFilterCount = (f: ActivityAdvancedFilter) =>
  (f.pipelineType ? 1 : 0) + (f.pipelineIds.length ? 1 : 0) + (f.card ? 1 : 0) + (f.tagIds?.length ? 1 : 0);

/** Parâmetros para activities.list / activities.counters. */
export function advancedFilterParams(f: ActivityAdvancedFilter): { pipelineTypes?: string[]; pipelineIds?: string[]; dealId?: string; tagIds?: string[] } {
  return {
    ...(f.pipelineType ? { pipelineTypes: [f.pipelineType] } : {}),
    ...(f.pipelineIds.length ? { pipelineIds: f.pipelineIds } : {}),
    ...(f.card ? { dealId: f.card.id } : {}),
    ...(f.tagIds?.length ? { tagIds: f.tagIds } : {}),
  };
}

/** Etiquetas de atividades e de cartões (negócio, ticket, projeto) para escolher no filtro. */
const TAG_GROUPS: { entities: Tag["entity"][]; label: string }[] = [
  { entities: ["activity"], label: "Da atividade" },
  { entities: ["deal", "ticket", "project"], label: "Do cartão" },
];

function Section({ icon, title, hint, color, children }: { icon: ReactNode; title: string; hint: string; color: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <p className={cn("flex items-center gap-2 text-theme-sm font-semibold", color)}>
        {icon}
        {title}
      </p>
      <p className="mb-3 mt-0.5 text-theme-xs text-gray-500">{hint}</p>
      {children}
    </section>
  );
}

export function ActivityFilterDrawer({
  isOpen,
  value,
  onApply,
  onClose,
}: {
  isOpen: boolean;
  value: ActivityAdvancedFilter;
  onApply: (f: ActivityAdvancedFilter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ActivityAdvancedFilter>(value);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => {
    if (!isOpen) return;
    setDraft(value);
    void call("pipelines.list", {}).then(setPipelines);
    void Promise.all((["activity", "deal", "ticket", "project"] as const).map((entity) => call("tags.list", { entity }))).then((l) => setTags(l.flat()));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTag = (t: Tag) =>
    setDraft((d) => {
      const on = d.tagIds.includes(t.id);
      const tagIds = on ? d.tagIds.filter((x) => x !== t.id) : [...d.tagIds, t.id];
      return { ...d, tagIds, tagNames: tags.filter((x) => tagIds.includes(x.id)).map((x) => x.name) };
    });

  const types = useMemo(() => [...new Set(pipelines.map((p) => p.type))], [pipelines]);
  const visible = useMemo(
    () => pipelines.filter((p) => !draft.pipelineType || p.type === draft.pipelineType).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [pipelines, draft.pipelineType],
  );

  const setType = (t: PipelineType | "") =>
    setDraft((d) => ({
      ...d,
      pipelineType: t,
      // Funis de outro tipo saem da seleção; o cartão também, se for de outro tipo.
      pipelineIds: t ? d.pipelineIds.filter((id) => pipelines.find((p) => p.id === id)?.type === t) : d.pipelineIds,
      card: null,
    }));
  const togglePipeline = (id: string) =>
    setDraft((d) => ({ ...d, card: null, pipelineIds: d.pipelineIds.includes(id) ? d.pipelineIds.filter((x) => x !== id) : [...d.pipelineIds, id] }));

  const searchCards = async (text: string): Promise<ComboItem[]> => {
    const rows = await call("cards.search", {
      search: text,
      limit: 30,
      ...(draft.pipelineIds.length ? { pipelineIds: draft.pipelineIds } : {}),
      ...(draft.pipelineType ? { pipelineTypes: [draft.pipelineType] } : {}),
    });
    return rows.map((r) => ({ id: r.id, label: r.title, sublabel: [r.pipeline_name, r.organization_name ?? r.person_name].filter(Boolean).join(" · ") }));
  };

  return (
    <TaDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Filtros avançados"
      footer={
        <div className="flex gap-2" data-activity-filter-footer>
          <TaButton
            variant="primary"
            className="flex-1"
            data-activity-filter-apply
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Aplicar filtros
          </TaButton>
          <TaButton
            data-activity-filter-clear
            onClick={() => {
              setDraft(EMPTY_ADVANCED_FILTER);
              onApply(EMPTY_ADVANCED_FILTER);
              onClose();
            }}
          >
            Limpar tudo
          </TaButton>
        </div>
      }
    >
      <div className="space-y-4" data-activity-filter-drawer>
        <Section icon={<Layers size={16} />} title="Tipo de funil" hint="Comercial, operacional ou projeto." color="text-brand-600">
          <TaSelect value={draft.pipelineType} onChange={(e) => setType(e.target.value as PipelineType | "")} data-activity-filter-type>
            <option value="">Todos os tipos</option>
            {(types.length ? types : (Object.keys(PIPELINE_TYPE_LABEL) as PipelineType[])).map((t) => (
              <option key={t} value={t}>
                {PIPELINE_TYPE_LABEL[t]}
              </option>
            ))}
          </TaSelect>
        </Section>

        <Section icon={<GitBranch size={16} />} title="Funis" hint="Selecione um ou mais funis." color="text-purple-600">
          {visible.length === 0 ? (
            <p className="text-theme-xs text-gray-500">Nenhum funil deste tipo.</p>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1" data-activity-filter-pipelines>
              {visible.map((p) => {
                const on = draft.pipelineIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-theme-sm",
                      on ? "border-brand-300 bg-brand-25 text-brand-700 dark:bg-brand-500/10" : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300",
                    )}
                  >
                    <input type="checkbox" checked={on} onChange={() => togglePipeline(p.id)} className="accent-brand-500" />
                    <span className="truncate">{p.name}</span>
                    {!draft.pipelineType && <span className="ml-auto shrink-0 text-theme-xs text-gray-400">{PIPELINE_TYPE_LABEL[p.type]}</span>}
                  </label>
                );
              })}
            </div>
          )}
        </Section>

        <Section icon={<SquareKanban size={16} />} title="Cartão" hint="Atividades de um cartão (busca pelo título, contato ou organização)." color="text-success-600">
          <div data-activity-filter-card>
            <Combobox
              key={`${draft.pipelineType}|${draft.pipelineIds.join(",")}`}
              value={draft.card}
              onChange={(card) => setDraft((d) => ({ ...d, card }))}
              search={searchCards}
              placeholder="Buscar cartão…"
              emptyText="Nenhum cartão encontrado."
            />
          </div>
        </Section>

        <Section icon={<TagIcon size={16} />} title="Etiquetas" hint="A atividade ou o cartão dela tem pelo menos uma das etiquetas marcadas." color="text-warning-600">
          {tags.length === 0 ? (
            <p className="text-theme-xs text-gray-500">Nenhuma etiqueta cadastrada.</p>
          ) : (
            <div className="space-y-2" data-activity-filter-tags>
              {TAG_GROUPS.map((g) => {
                const list = tags.filter((t) => g.entities.includes(t.entity)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
                if (!list.length) return null;
                return (
                  <div key={g.label}>
                    <p className="mb-1 text-theme-xs text-gray-400">{g.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((t) => {
                        const on = draft.tagIds.includes(t.id);
                        const pal = badgePalette[(t.color as BadgeColor) in badgePalette ? (t.color as BadgeColor) : "slate"];
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => toggleTag(t)}
                            aria-pressed={on}
                            className={cn(
                              "rounded-full border px-2.5 py-0.5 text-theme-xs transition",
                              on ? "border-transparent font-semibold ring-2 ring-brand-400" : "border-gray-200 opacity-80 hover:opacity-100 dark:border-gray-700",
                            )}
                            style={{ background: pal.bg, color: pal.fg }}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <p className="flex items-center gap-1.5 text-theme-xs text-gray-400">
          <Filter size={12} /> Valem junto com a busca, o responsável, o tipo e a situação da barra de filtros.
        </p>
      </div>
    </TaDrawer>
  );
}
