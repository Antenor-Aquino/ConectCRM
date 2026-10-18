// Cartão do quadro: título sempre; os demais campos vêm da configuração do
// funil (Editar funil → Cartão), na ordem escolhida. O valor fica no topo e
// o responsável no rodapé, como no mockup.
import type { ReactNode } from "react";
import { Building2, CalendarClock, Check, CheckSquare, Clock, FileText, Mail, MapPin, NotebookText, Package, Percent, Phone, Tag as TagIcon, X } from "lucide-react";
import { badgePalette, cn, type BadgeColor } from "@tailadmin";
import type { BoardCard } from "../../db/deals";
import type { CardFieldValue } from "../../db/cardFieldValues";
import type { Pipeline } from "../../db/pipelines";
import { parseCardFields } from "../../lib/cardFields";
import { outcomeLabel } from "../../lib/cardTypes";
import { formatDate } from "../../lib/format";
import { Avatar } from "../ui/Avatar";
import { EmailLink, PhoneLink, WebLink } from "../ui/ContactLinks";
import { ActivityIndicator } from "./ActivityIndicator";

/** Rótulo curto antes do valor (vazio = só ícone). */
const PREFIX: Record<string, string> = {
  probabilidade: "Prob.",
  previsao_fechamento: "Previsão",
  sla: "SLA",
  inicio: "Início",
  prazo: "Prazo",
  etapa_dias: "Na etapa há",
  proxima_tarefa: "Próxima",
  tarefas: "Atividades",
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

/** Desfecho do cartão: verde (ganho/resolvido/concluído) ou vermelho (perdido/não…). */
export interface CardOutcome {
  won: boolean;
  label: string;
  closedAt: string | null;
}

/** Corpo do cartão a partir dos campos; usado no quadro e na prévia da configuração. */
export function CardFields({
  title,
  keys,
  fields,
  outcome,
  indicator,
}: {
  title: string;
  keys: string[];
  fields: Record<string, CardFieldValue>;
  outcome?: CardOutcome | null;
  /** Indicador de atividades (cartões em aberto do quadro). */
  indicator?: React.ReactNode;
}) {
  const text = (k: string) => {
    const v = fields[k];
    return v && "text" in v ? v : null;
  };
  const value = keys.includes("valor") ? text("valor") : null;
  const owner = keys.includes("responsavel") ? text("responsavel") : null;
  return (
    <>
      <div className={cn("flex items-start gap-2", outcome && "pr-5")}>
        <span
          className={cn(
            "min-w-0 flex-1 break-words text-theme-sm font-medium",
            !outcome && "text-brand-600 dark:text-brand-400",
            outcome?.won && "text-success-700 dark:text-success-400",
            outcome && !outcome.won && "text-error-700 dark:text-error-400",
          )}
        >
          {title}
        </span>
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
          // Telefone abre o WhatsApp; e-mail, o provedor de e-mail do usuário; organização com site, o site.
          const content = v.phone ? (
            <PhoneLink phone={v.phone}>{v.text}</PhoneLink>
          ) : v.email ? (
            <EmailLink email={v.email}>{v.text}</EmailLink>
          ) : v.url ? (
            <WebLink url={v.url}>{v.text}</WebLink>
          ) : (
            v.text
          );
          return (
            <div key={k} className={cn("mt-1 flex items-center gap-1.5 text-theme-xs", v.tone === "danger" ? "text-error-600" : "text-gray-500 dark:text-gray-400")}>
              <span className="shrink-0 opacity-70">{ICON[k] ?? <TagIcon size={13} />}</span>
              <span className={cn("min-w-0", k === "descricao" || k === "produtos" ? "line-clamp-2" : "truncate")}>
                {label && <span className="text-gray-400">{label}: </span>}
                {content}
              </span>
            </div>
          );
        })}
      {(owner || outcome || indicator) && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {outcome ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                outcome.won ? "bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-400" : "bg-error-100 text-error-700 dark:bg-error-500/20 dark:text-error-400",
              )}
            >
              {outcome.won ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
              {outcome.label}
              {outcome.closedAt && <span className="font-normal opacity-80">em {formatDate(outcome.closedAt)}</span>}
            </span>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-1.5">
            {indicator}
            {owner && <Avatar name={owner.text} size={24} title={`Responsável: ${owner.text}`} />}
          </span>
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
  onOpenActivity,
  onNewActivity,
  onChanged,
  selected,
  selecting,
  onToggleSelect,
}: {
  card: BoardCard;
  pipeline: Pipeline;
  dragging: boolean;
  onOpen: () => void;
  onOpenActivity?: (id: string) => void;
  onNewActivity?: () => void;
  onChanged?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  /** Seleção para ações em lote: com algum selecionado, clicar no cartão marca/desmarca. */
  selected?: boolean;
  selecting?: boolean;
  onToggleSelect?: () => void;
}) {
  const label = outcomeLabel(pipeline.type, card.status);
  const outcome: CardOutcome | null = label ? { won: card.status === "won", label, closedAt: card.closed_at } : null;
  return (
    <div
      draggable
      data-card-id={card.id}
      title={outcome ? `${outcome.label}${outcome.closedAt ? ` em ${formatDate(outcome.closedAt)}` : ""}` : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={selecting && onToggleSelect ? onToggleSelect : onOpen}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl border p-3.5 shadow-theme-xs transition hover:shadow-theme-sm",
        selecting && "pl-9",
        dragging && "opacity-40",
        card.status === "open" && "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900",
        card.status === "won" && "border-success-300 bg-success-50 dark:border-success-500/40 dark:bg-success-500/10",
        card.status === "lost" && "border-error-300 bg-error-50 dark:border-error-500/40 dark:bg-error-500/10",
        selected && "!border-brand-400 outline outline-2 outline-brand-300",
      )}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={!!selected}
          aria-label={`Selecionar ${card.title}`}
          title="Selecionar para ações em lote"
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleSelect}
          className={cn("absolute left-3 top-3.5 z-10 h-4 w-4 cursor-pointer accent-brand-500", !selecting && "opacity-0 group-hover:opacity-100")}
        />
      )}
      {outcome && (
        // Canto dobrado com ✓ / ✕ (como nos CRMs de referência).
        <span
          aria-hidden
          className={cn("absolute right-0 top-0 h-9 w-9 text-white", outcome.won ? "bg-success-500" : "bg-error-500")}
          style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%)" }}
        >
          {outcome.won ? <Check size={14} strokeWidth={3} className="absolute right-1 top-1" /> : <X size={14} strokeWidth={3} className="absolute right-1 top-1" />}
        </span>
      )}
      <CardFields
        title={card.title}
        keys={parseCardFields(pipeline.card_fields, pipeline.type)}
        fields={card.fields}
        outcome={outcome}
        indicator={
          card.status === "open" && onOpenActivity && onNewActivity ? (
            <ActivityIndicator card={card} onOpenActivity={onOpenActivity} onNewActivity={onNewActivity} onChanged={onChanged ?? (() => undefined)} />
          ) : null
        }
      />
    </div>
  );
}
