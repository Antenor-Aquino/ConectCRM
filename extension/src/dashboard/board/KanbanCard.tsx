// Cartão do quadro (tela inicial): título, valor, contato e responsável.
// Indicadores do rodapé ficam para depois (decisão do cliente).
import { cn } from "@tailadmin";
import type { BoardCard } from "../../db/deals";
import type { PipelineType } from "../../db/pipelines";
import { formatCents, formatDateTime } from "../../lib/format";
import { Avatar } from "../ui/Avatar";

export function KanbanCard({
  card,
  type,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  type: PipelineType;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const closed = card.status !== "open";
  return (
    <div
      draggable
      data-card-id={card.id}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        "cursor-pointer rounded-xl border border-gray-200 bg-white p-3.5 shadow-theme-xs transition hover:shadow-theme-sm dark:border-gray-800 dark:bg-gray-900",
        dragging && "opacity-40",
        card.status === "lost" && "bg-error-25 dark:bg-error-500/10",
        card.status === "won" && "bg-success-25 dark:bg-success-500/10",
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn("min-w-0 flex-1 break-words text-theme-sm font-medium text-brand-600 dark:text-brand-400", closed && "opacity-70")}>{card.title}</span>
        {type === "comercial" && <span className="shrink-0 text-theme-sm font-semibold text-gray-800 dark:text-white/90">{formatCents(card.value_cents)}</span>}
      </div>
      {(card.person_name || card.organization_name) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-theme-xs text-gray-600 dark:text-gray-400">
          <Avatar name={card.person_name ?? card.organization_name} size={18} />
          <span className="truncate">{card.person_name ?? card.organization_name}</span>
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="truncate text-theme-xs text-gray-400">
          {type === "operacional" && card.sla_at && `SLA ${formatDateTime(card.sla_at)}`}
          {type === "projeto" && card.due_at && `Prazo ${formatDateTime(card.due_at).slice(0, 10)}`}
        </span>
        {card.owner_name && <Avatar name={card.owner_name} size={24} title={`Responsável: ${card.owner_name}`} />}
      </div>
    </div>
  );
}
