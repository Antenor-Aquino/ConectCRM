// Indicador de atividades no cartão do quadro (como no HubSpot):
// vermelho = atrasada, verde = para hoje, cinza = futura, amarelo = nenhuma.
// O clique abre um painel com as atividades pendentes: concluir, abrir e agendar.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { ActivityListItem } from "../../db/activities";
import type { BoardCard } from "../../db/deals";
import { ActivityIcon } from "../../lib/activityIcons";
import { errorText } from "../../lib/errors";
import { isOverdue, overdueFrom, taskTiming } from "../../lib/taskTiming";

export type ActivityState = "overdue" | "today" | "future" | "none";

export function activityState(c: Pick<BoardCard, "act_overdue" | "act_today" | "act_pending">): ActivityState {
  if (c.act_overdue > 0) return "overdue";
  if (c.act_today > 0) return "today";
  if (c.act_pending > 0) return "future";
  return "none";
}

const LOOK: Record<ActivityState, { title: string; cls: string; icon: React.ReactNode }> = {
  overdue: { title: "Atividade atrasada", cls: "bg-error-500 text-white hover:bg-error-600", icon: <ChevronLeft size={13} strokeWidth={3} /> },
  today: { title: "Atividade para hoje", cls: "bg-success-500 text-white hover:bg-success-600", icon: <ChevronRight size={13} strokeWidth={3} /> },
  future: { title: "Próxima atividade agendada", cls: "bg-gray-400 text-white hover:bg-gray-500", icon: <ChevronRight size={13} strokeWidth={3} /> },
  none: { title: "Nenhuma atividade agendada", cls: "text-warning-500 hover:text-warning-600", icon: <AlertTriangle size={17} fill="currentColor" stroke="white" strokeWidth={2} /> },
};

export function ActivityIndicator({
  card,
  onOpenActivity,
  onNewActivity,
  onChanged,
}: {
  card: BoardCard;
  onOpenActivity: (id: string) => void;
  onNewActivity: () => void;
  onChanged: () => void;
}) {
  const state = activityState(card);
  const look = LOOK[state];
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [items, setItems] = useState<ActivityListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    call("activities.list", { dealId: card.id, done: false }).then((list) =>
      // Atrasadas primeiro (a mais antiga no topo), depois pela data.
      setItems([...list].sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || overdueFrom(a).localeCompare(overdueFrom(b)))),
    );

  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    // Painel fixo na tela (as colunas do quadro cortam o que passa da borda).
    const width = 320;
    setPos({ top: Math.min(r.bottom + 6, window.innerHeight - 280), left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
    setError(null);
    void load();
  };

  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null);
    };
    // Esc fecha só este menu (captura antes da janela/painel por baixo, que também fecha com Esc).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setPos(null);
    };
    // Rolar o quadro fecha (o painel ficaria solto); rolar a lista do painel, não.
    const off = (e: Event) => !panel.current?.contains(e.target as Node) && setPos(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc, true);
    window.addEventListener("scroll", off, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc, true);
      window.removeEventListener("scroll", off, true);
    };
  }, [pos]);

  const done = async (id: string) => {
    setError(null);
    try {
      await call("activities.setDone", { id, done: true });
      await load();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        title={look.title}
        aria-label={look.title}
        data-activity-state={state}
        onClick={open}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition", look.cls)}
      >
        {look.icon}
      </button>
      {pos &&
        createPortal(
          <div
            ref={panel}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[100000] w-80 rounded-xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-700 dark:bg-gray-900"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="max-h-64 overflow-y-auto p-1.5 custom-scrollbar">
              {items === null && <p className="px-3 py-3 text-theme-sm text-gray-400">Carregando…</p>}
              {items?.length === 0 && (
                <p className="flex items-center gap-2 px-3 py-3 text-theme-sm text-warning-700">
                  <AlertTriangle size={15} /> Nenhuma atividade agendada para este cartão.
                </p>
              )}
              {items?.map((a) => {
                const t = taskTiming(a);
                return (
                  <div key={a.id} className="rounded-lg px-2.5 py-2 hover:bg-gray-50 dark:hover:bg-white/5">
                    <div className="flex items-start gap-2">
                      <ActivityIcon name={a.type_icon} size={15} className="mt-0.5 shrink-0 text-gray-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90" title={a.title}>
                          {a.title}
                        </p>
                        <p className={cn("text-theme-xs", t.tone === "danger" ? "font-medium text-error-600" : t.tone === "warning" ? "text-warning-600" : "text-gray-500")}>
                          {t.label}
                          {a.owner_name ? <span className="font-normal text-gray-400"> · {a.owner_name}</span> : null}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-1.5 pl-6">
                      <button
                        type="button"
                        onClick={() => void done(a.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-success-500 px-2.5 py-1 text-theme-xs font-semibold text-white shadow-theme-xs hover:bg-success-600"
                      >
                        <Check size={13} strokeWidth={3} /> Concluir
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPos(null);
                          onOpenActivity(a.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1 text-theme-xs font-semibold text-brand-700 hover:bg-brand-100 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
                      >
                        <ExternalLink size={12} /> Abrir
                      </button>
                    </div>
                  </div>
                );
              })}
              {error && <p className="px-3 py-1 text-theme-xs text-error-600">{error}</p>}
            </div>
            <div className="border-t border-gray-100 p-2 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setPos(null);
                  onNewActivity();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-theme-sm font-semibold text-white shadow-theme-xs hover:bg-brand-600"
              >
                <Plus size={15} /> Agendar uma atividade
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
