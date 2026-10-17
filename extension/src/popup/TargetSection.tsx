// Negócio de destino (como no wa-pipedrive): busca e escolha do cartão, resumo,
// tarefas em aberto e ações rápidas (novo cartão, tarefa, reunião, nota).
import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, CheckCircle2, Circle, ExternalLink, ListPlus, NotebookPen, Plus, Target, X } from "lucide-react";
import { TaBadge, TaButton, TaTextarea, cn } from "@tailadmin";
import { call } from "../rpc/client";
import type { ActivityListItem } from "../db/activities";
import type { CardDetail } from "../db/deals";
import type { PipelineType } from "../db/pipelines";
import { CARD_TEXT } from "../lib/cardTypes";
import { formatCents } from "../lib/format";
import { taskTiming } from "../lib/taskTiming";
import { useSession } from "../dashboard/session";
import { Combobox, type ComboItem } from "../dashboard/ui/Combobox";
import { errText, openCrm, Section, StatusText, type Status } from "./ui";

const KIND = { deal: "Negócio", ticket: "Ticket", project: "Projeto" } as const;

async function searchCards(text: string): Promise<ComboItem[]> {
  const list = await call("cards.search", { search: text });
  return list.map((c) => ({ id: c.id, label: c.title, sublabel: `${KIND[c.kind]} · ${c.pipeline_name}${c.person_name ? ` · ${c.person_name}` : ""}` }));
}

export function TargetSection({
  targetId,
  setTarget,
  refreshKey,
  activeTypes,
  onNewCard,
  onNewTask,
}: {
  targetId: string | null;
  setTarget: (id: string | null) => void;
  refreshKey: number;
  activeTypes: PipelineType[];
  onNewCard: (type: PipelineType) => void;
  onNewTask: (meeting: boolean) => void;
}) {
  const { users } = useSession();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [stageName, setStageName] = useState("");
  const [pipelineName, setPipelineName] = useState("");
  const [tasks, setTasks] = useState<ActivityListItem[]>([]);
  const [newMenu, setNewMenu] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    if (!targetId) {
      setCard(null);
      return;
    }
    const c = await call("cards.get", { id: targetId }).catch(() => null);
    if (!c) {
      setTarget(null);
      return;
    }
    setCard(c);
    const [stages, pipelines, open] = await Promise.all([
      call("stages.list", { pipelineId: c.pipeline_id }),
      call("pipelines.list", {}),
      call("activities.list", { dealId: c.id, done: false }),
    ]);
    setStageName(stages.find((s) => s.id === c.stage_id)?.name ?? "");
    setPipelineName(pipelines.find((p) => p.id === c.pipeline_id)?.name ?? "");
    setTasks(open);
  }, [targetId, setTarget]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const saveNote = async () => {
    try {
      await call("notes.add", { entityType: "deal", entityId: card!.id, body: note });
      setNote("");
      setNoteOpen(false);
      setStatus({ text: "Nota gravada.", kind: "ok" });
    } catch (e) {
      setStatus({ text: errText(e), kind: "err" });
    }
  };

  const owner = users.find((u) => u.id === card?.owner_id);

  return (
    <Section title="Negócio de destino" icon={<Target size={16} />}>
      {!card ? (
        <Combobox value={null} onChange={(item) => item && setTarget(item.id)} search={searchCards} placeholder="Buscar negócio, ticket ou projeto…" emptyText="Nada encontrado. Crie um novo abaixo." />
      ) : (
        <div className="rounded-xl border border-brand-200 bg-brand-25 p-3 dark:border-brand-500/30 dark:bg-brand-500/5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                <span className="truncate">{card.title}</span>
                {card.status !== "open" && <TaBadge color={card.status === "won" ? "green" : "red"} label={card.status === "won" ? "Ganho" : "Perdido"} />}
              </p>
              <p className="truncate text-theme-xs text-gray-500">
                {KIND[card.kind]} · {pipelineName} › {stageName}
              </p>
              <p className="truncate text-theme-xs text-gray-500">
                {[card.person_name, card.organization_name, owner && `Resp.: ${owner.name}`].filter(Boolean).join(" · ") || "Sem contato"}
                {card.kind === "deal" && card.value_cents > 0 && ` · ${formatCents(card.value_cents)}`}
              </p>
            </div>
            <button type="button" title="Abrir no CRM" className="text-gray-400 hover:text-brand-600" onClick={() => openCrm(`?negocio=${card.id}`)}>
              <ExternalLink size={15} />
            </button>
            <button type="button" title="Trocar o destino" className="text-gray-400 hover:text-error-600" onClick={() => setTarget(null)}>
              <X size={15} />
            </button>
          </div>
          {tasks.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-brand-100 pt-2 dark:border-brand-500/20">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-theme-xs">
                  <button
                    type="button"
                    title="Concluir"
                    className="text-gray-400 hover:text-success-600"
                    onClick={async () => {
                      await call("activities.setDone", { id: t.id, done: true });
                      await load();
                    }}
                  >
                    {t.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{t.title}</span>
                  <span className={cn(taskTiming(t).tone === "danger" ? "text-error-600" : "text-gray-400")}>{taskTiming(t).label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="relative mt-3 grid grid-cols-4 gap-1.5">
        <TaButton size="sm" startIcon={<Plus size={14} />} onClick={() => (activeTypes.length === 1 ? onNewCard(activeTypes[0]!) : setNewMenu((v) => !v))}>
          Novo
        </TaButton>
        <TaButton size="sm" disabled={!card} startIcon={<ListPlus size={14} />} onClick={() => onNewTask(false)}>
          Tarefa
        </TaButton>
        <TaButton size="sm" disabled={!card} startIcon={<CalendarPlus size={14} />} onClick={() => onNewTask(true)}>
          Reunião
        </TaButton>
        <TaButton size="sm" disabled={!card} startIcon={<NotebookPen size={14} />} onClick={() => setNoteOpen((v) => !v)}>
          Nota
        </TaButton>
        {newMenu && (
          <div className="absolute left-0 top-10 z-20 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900">
            {activeTypes.map((t) => (
              <button
                key={t}
                type="button"
                className="block w-full rounded-lg px-3 py-2 text-left text-theme-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                onClick={() => {
                  setNewMenu(false);
                  onNewCard(t);
                }}
              >
                {CARD_TEXT[t].newTitle}
              </button>
            ))}
            {activeTypes.length === 0 && <p className="px-3 py-2 text-theme-xs text-gray-500">Crie um funil no CRM primeiro.</p>}
          </div>
        )}
      </div>

      {noteOpen && card && (
        <div className="mt-3">
          <TaTextarea rows={4} autoFocus placeholder="Escreva a nota que será registrada no cartão…" value={note} onChange={(e) => setNote(e.target.value)} />
          <TaButton className="mt-2" variant="primary" size="sm" disabled={!note.trim()} onClick={() => void saveNote()}>
            Salvar nota
          </TaButton>
        </div>
      )}
      <StatusText status={status} />
    </Section>
  );
}
