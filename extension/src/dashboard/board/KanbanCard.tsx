// Cartão do quadro: título sempre; os demais campos vêm da configuração do
// funil (Editar funil → Cartão), na ordem escolhida. O valor fica no topo e
// o responsável no rodapé, como no mockup.
import type { ReactNode } from "react";
import { Building2, CalendarClock, CheckSquare, Clock, FileText, Mail, MapPin, NotebookText, Package, Percent, Phone, Tag as TagIcon } from "lucide-react";
import { badgePalette, cn, type BadgeColor } from "@tailadmin";
import type { BoardCard } from "../../db/deals";
import type { CardFieldValue } from "../../db/cardFieldValues";
import type { Pipeline } from "../../db/pipelines";
import { parseCardFields } from "../../lib/cardFields";
import { Avatar } from "../ui/Avatar";

/** Rótulo curto antes do valor (vazio = só ícone). */
const PREFIX: Record<string, string> = {
  probabilidade: "Prob.",
  previsao_fechamento: "Previsão",
  sla: "SLA",
  inicio: "Início",
  prazo: "Prazo",
  etapa_dias: "Na etapa há",
  proxima_tarefa: "Próxima",
  tarefas: "Tarefas",
  notas: "Notas",
  origem: "Origem",
  criado_em: "Criado em",
  org_cnpj: "CNPJ",
};
const ICON: Record<string, ReactNode> = {
  produtos: <Package size={13} />,
  probabilidade: <Percent size={13} />,
  previsao_fechamento: <CalendarClock size={13} />,
  sla: <Clock size={13} />,
  inicio: <CalendarClock size={13} />,
  prazo: <CalendarClock size={13} />,
  etapa_dias: <Clock size={13} />,
  proxima_tarefa: <CheckSquare size={13} />,
  tarefas: <CheckSquare size={13} />,
  notas: <NotebookText size={13} />,
  descricao: <FileText size={13} />,
  contato_telefone: <Phone size={13} />,
  contato_email: <Mail size={13} />,
  organizacao: <Building2 size={13} />,
  org_cidade: <MapPin size={13} />,
  org_cnpj: <Building2 size={13} />,
  org_segmento: <TagIcon size={13} />,
  org_telefone: <Phone size={13} />,
  origem: <TagIcon size={13} />,
  criado_em: <CalendarClock size={13} />,
};

/** Corpo do cartão a partir dos campos; usado no quadro e na prévia da configuração. */
export function CardFields({ title, keys, fields, closed }: { title: string; keys: string[]; fields: Record<string, CardFieldValue>; closed?: boolean }) {
  const text = (k: string) => {
    const v = fields[k];
    return v && "text" in v ? v : null;
  };
  const value = keys.includes("valor") ? text("valor") : null;
  const owner = keys.includes("responsavel") ? text("responsavel") : null;
  return (
    <>
      <div className="flex items-start gap-2">
        <span className={cn("min-w-0 flex-1 break-words text-theme-sm font-medium text-brand-600 dark:text-brand-400", closed && "opacity-70")}>{title}</span>
        {value && <span className="shrink-0 text-theme-sm font-semibold text-gray-800 dark:text-white/90">{value.text}</span>}
      </div>
      {keys
        .filter((k) => k !== "valor" && k !== "responsavel")
        .map((k) => {
          const v = fields[k];
          if (!v) return null;
          if ("tags" in v) {
            return (
              <div key={k} className="mt-1.5 flex flex-wrap gap-1">
                {v.tags.map((t) => {
                  const c = badgePalette[(t.color as BadgeColor) ?? "slate"] ?? badgePalette.slate;
                  return (
                    <span key={t.name} className="rounded-full border px-1.5 py-px text-[10px] font-medium" style={{ background: c.bg, color: c.fg, borderColor: c.border }}>
                      {t.name}
                    </span>
                  );
                })}
              </div>
            );
          }
          if (k === "contato") {
            return (
              <div key={k} className="mt-1.5 flex items-center gap-1.5 text-theme-xs text-gray-600 dark:text-gray-400">
                <Avatar name={v.text} size={18} />
                <span className="truncate">{v.text}</span>
              </div>
            );
          }
          const label = v.label ?? PREFIX[k];
          return (
            <div key={k} className={cn("mt-1 flex items-center gap-1.5 text-theme-xs", v.tone === "danger" ? "text-error-600" : "text-gray-500 dark:text-gray-400")}>
              <span className="shrink-0 opacity-70">{ICON[k] ?? <TagIcon size={13} />}</span>
              <span className={cn("min-w-0", k === "descricao" || k === "produtos" ? "line-clamp-2" : "truncate")}>
                {label && <span className="text-gray-400">{label}: </span>}
                {v.text}
              </span>
            </div>
          );
        })}
      {owner && (
        <div className="mt-2.5 flex justify-end">
          <Avatar name={owner.text} size={24} title={`Responsável: ${owner.text}`} />
        </div>
      )}
    </>
  );
}

export function KanbanCard({
  card,
  pipeline,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  pipeline: Pipeline;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
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
      <CardFields title={card.title} keys={parseCardFields(pipeline.card_fields, pipeline.type)} fields={card.fields} closed={card.status !== "open"} />
    </div>
  );
}
