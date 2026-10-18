// Peças comuns do GED: navegação pelos vínculos, etiquetas de vínculo,
// classificação, validade e ícone do arquivo.
import { createContext, useContext, type ReactNode } from "react";
import { Building2, CheckSquare, FileAudio, FileImage, FileSpreadsheet, FileText, File as FileIcon, Filter, Lock, User, X } from "lucide-react";
import { badgePalette, cn, type BadgeColor } from "@tailadmin";
import type { DocLink, DocLinkType } from "../../db/documents";

/** Abrir o cadastro de um vínculo (fornecido pelo App). */
export interface DocumentNav {
  openCard: (pipelineId: string, cardId: string) => void;
  openPerson: (id: string) => void;
  openOrganization: (id: string) => void;
  openTask: (id: string) => void;
}

const NavContext = createContext<DocumentNav | null>(null);
/** Avisado ao seguir um vínculo: a janela do documento fecha para o cadastro aparecer. */
export const DOC_NAV_EVENT = "conectcrm:documento-navegou";
export const DocumentNavProvider = NavContext.Provider;
export const useDocumentNav = () => useContext(NavContext);

export const LINK_TYPE_LABEL: Record<DocLinkType, string> = { deal: "Cartão", activity: "Atividade", person: "Contato", organization: "Organização" };

export function LinkIcon({ type, size = 13 }: { type: DocLinkType; size?: number }) {
  if (type === "deal") return <Filter size={size} />;
  if (type === "activity") return <CheckSquare size={size} />;
  if (type === "person") return <User size={size} />;
  return <Building2 size={size} />;
}

/** Vínculo como etiqueta; clicável quando há navegação. */
export function LinkChip({ link, onRemove, title }: { link: DocLink; onRemove?: () => void; title?: string }) {
  const nav = useDocumentNav();
  const open = () => {
    if (!nav) return;
    window.dispatchEvent(new Event(DOC_NAV_EVENT));
    if (link.type === "deal" && link.pipeline_id) nav.openCard(link.pipeline_id, link.id);
    else if (link.type === "activity") nav.openTask(link.id);
    else if (link.type === "person") nav.openPerson(link.id);
    else if (link.type === "organization") nav.openOrganization(link.id);
  };
  const text = link.type === "deal" && link.sub ? `${link.sub} › ${link.label}` : link.label;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-theme-xs",
        link.auto
          ? "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-white/5 dark:text-gray-300"
          : "border-brand-200 bg-brand-25 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300",
      )}
    >
      <span className="shrink-0 opacity-70">
        <LinkIcon type={link.type} size={12} />
      </span>
      {nav && !onRemove ? (
        <button type="button" onClick={open} title={title ?? `Abrir ${LINK_TYPE_LABEL[link.type].toLowerCase()}`} className="truncate hover:underline">
          {text}
        </button>
      ) : (
        <span className="truncate" title={`${LINK_TYPE_LABEL[link.type]}: ${text}`}>
          {text}
        </span>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} title="Tirar este vínculo" className="shrink-0 opacity-60 hover:opacity-100">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

export function TypeBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name)
    return (
      <span className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 dark:border-gray-600">Não classificado</span>
    );
  const c = badgePalette[(color as BadgeColor) ?? "slate"] ?? badgePalette.slate;
  return (
    <span
      className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
    >
      {name}
    </span>
  );
}

const dayMs = 86400_000;
const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
export const formatDay = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

/** Validade: vencido (vermelho), vence em até 30 dias (laranja) ou válido. */
export function ValidityBadge({ validUntil }: { validUntil: string | null }) {
  if (!validUntil) return null;
  const days = Math.round((new Date(`${validUntil}T00:00:00`).getTime() - today().getTime()) / dayMs);
  const [text, cls] =
    days < 0
      ? [`Vencido há ${-days} dia${days === -1 ? "" : "s"}`, "bg-error-50 text-error-700 border-error-200"]
      : days === 0
        ? ["Vence hoje", "bg-warning-50 text-warning-700 border-warning-200"]
        : days <= 30
          ? [`Vence em ${days} dia${days === 1 ? "" : "s"}`, "bg-warning-50 text-warning-700 border-warning-200"]
          : [`Válido até ${formatDay(validUntil)}`, "bg-gray-50 text-gray-600 border-gray-200 dark:bg-white/5 dark:text-gray-300 dark:border-gray-700"];
  return <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", cls)}>{text}</span>;
}

export function RestrictedBadge() {
  return (
    <span
      title="Restrito: só quem enviou, administradores e o responsável pelo cartão"
      className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 dark:border-gray-600 dark:text-gray-300"
    >
      <Lock size={11} /> Restrito
    </span>
  );
}

export function FileTypeIcon({ mime, size = 18 }: { mime: string; size?: number }) {
  if (mime === "application/pdf") return <FileText size={size} className="text-error-500" />;
  if (mime.startsWith("image/")) return <FileImage size={size} className="text-blue-light-500" />;
  if (mime.startsWith("audio/")) return <FileAudio size={size} className="text-brand-500" />;
  if (/spreadsheet|excel|csv/.test(mime)) return <FileSpreadsheet size={size} className="text-success-600" />;
  if (/word|text|opendocument/.test(mime)) return <FileText size={size} className="text-brand-500" />;
  return <FileIcon size={size} className="text-gray-500" />;
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-theme-xs text-gray-400">{children}</span>;
}
