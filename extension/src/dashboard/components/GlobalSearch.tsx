// Pesquisa geral na barra superior: cartões (inclusive pelo número do ticket),
// contatos, organizações, atividades, notas e documentos. Ctrl+K ou "/" foca o
// campo; setas e Enter escolhem; Esc fecha.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, CheckSquare, FileText, KanbanSquare, NotebookText, Search, User, X } from "lucide-react";
import { cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { GlobalSearchResult } from "../../db/globalSearch";
import { formatDateTime } from "../../lib/format";
import { CARD_TEXT, PIPELINE_TYPE_BY_KIND } from "../../lib/cardTypes";

export interface GlobalSearchNav {
  openCard: (pipelineId: string, cardId: string) => void;
  openPerson: (id: string) => void;
  openOrganization: (id: string) => void;
  openTask: (id: string) => void;
  openDocument: (id: string) => void;
}

interface Item {
  key: string;
  icon: ReactNode;
  title: string;
  detail: string;
  badge?: string;
  open: () => void;
}

const EMPTY: GlobalSearchResult = { cards: [], persons: [], organizations: [], activities: [], notes: [], documents: [] };

export function GlobalSearch({ nav }: { nav: GlobalSearchNav }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<GlobalSearchResult>(EMPTY);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Telas menores que 2xl: só a lupa; o campo abre por cima ao clicar (ou Ctrl+K).
  const [expanded, setExpanded] = useState(false);
  const wide = () => window.matchMedia("(min-width: 1536px)").matches;
  const focusField = () => {
    setExpanded(true);
    setOpen(true);
    setTimeout(() => input.current?.focus(), 0);
  };

  useEffect(() => {
    const term = text.trim();
    if (!term) return setResult(EMPTY);
    setLoading(true);
    const t = setTimeout(() => {
      void call("search.global", { text: term })
        .then((r) => {
          setResult(r);
          setActive(0);
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [text]);

  // Ctrl+K / "/" (fora de campos de texto) foca a pesquisa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        focusField();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const groups = useMemo(() => {
    const go = (fn: () => void) => () => {
      setOpen(false);
      setExpanded(false);
      fn();
    };
    const out: { label: string; items: Item[] }[] = [
      {
        label: "Cartões",
        items: result.cards.map((c) => ({
          key: `c${c.id}`,
          icon: <KanbanSquare size={15} />,
          title: c.title,
          detail: [c.pipeline_name, c.stage_name, c.person_name].filter(Boolean).join(" · "),
          badge: c.ticket_number != null ? `Ticket: ${c.ticket_number}` : CARD_TEXT[PIPELINE_TYPE_BY_KIND[c.kind]].noun,
          open: go(() => nav.openCard(c.pipeline_id, c.id)),
        })),
      },
      {
        label: "Contatos",
        items: result.persons.map((p) => ({
          key: `p${p.id}`,
          icon: <User size={15} />,
          title: p.name,
          detail: [p.organization, p.email, p.phone].filter(Boolean).join(" · "),
          open: go(() => nav.openPerson(p.id)),
        })),
      },
      {
        label: "Organizações",
        items: result.organizations.map((o) => ({
          key: `o${o.id}`,
          icon: <Building2 size={15} />,
          title: o.name,
          detail: [o.city, o.cnpj].filter(Boolean).join(" · "),
          open: go(() => nav.openOrganization(o.id)),
        })),
      },
      {
        label: "Atividades",
        items: result.activities.map((a) => ({
          key: `a${a.id}`,
          icon: <CheckSquare size={15} />,
          title: a.title,
          detail: [a.due_at ? formatDateTime(a.due_at) : null, a.deal_title, a.done ? "concluída" : null].filter(Boolean).join(" · "),
          open: go(() => nav.openTask(a.id)),
        })),
      },
      {
        label: "Notas",
        items: result.notes.map((n) => ({
          key: `n${n.id}`,
          icon: <NotebookText size={15} />,
          title: n.text || "(nota)",
          detail: `em ${n.entity_name}`,
          open: go(() =>
            n.entity_type === "deal" && n.pipeline_id
              ? nav.openCard(n.pipeline_id, n.entity_id)
              : n.entity_type === "person"
                ? nav.openPerson(n.entity_id)
                : nav.openOrganization(n.entity_id),
          ),
        })),
      },
      {
        label: "Documentos",
        items: result.documents.map((d) => ({
          key: `d${d.id}`,
          icon: <FileText size={15} />,
          title: d.name,
          detail: d.type_name ?? "Sem classificação",
          open: go(() => nav.openDocument(d.id)),
        })),
      },
    ];
    return out.filter((g) => g.items.length);
  }, [result, nav]);
  const flat = groups.flatMap((g) => g.items);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setExpanded(false);
      input.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flat[active]) flat[active].open();
  };

  let index = -1;
  return (
    <div ref={box} className="relative h-9 w-9 shrink-0 2xl:w-80" data-global-search>
      <button
        type="button"
        title="Pesquisar no CRM (Ctrl+K)"
        aria-label="Pesquisa geral"
        onClick={focusField}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 2xl:hidden",
          expanded && "invisible",
        )}
      >
        <Search size={18} />
      </button>
      <div className={cn("absolute right-0 top-0 w-80 2xl:block 2xl:w-full", expanded ? "block z-[100001]" : "hidden")}>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            if (!wide()) setExpanded(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Pesquisar no CRM (Ctrl+K)"
          aria-label="Pesquisar no CRM"
          className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-8 text-theme-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-white/5 dark:text-white/90"
        />
        {text && (
          <button
            type="button"
            title="Limpar"
            onClick={() => setText("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={15} />
          </button>
        )}
      </div>
      {open && text.trim() && (
        <div className="absolute right-0 top-11 z-[100000] max-h-[70vh] w-[420px] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-theme-lg custom-scrollbar dark:border-gray-700 dark:bg-gray-900">
          {flat.length === 0 ? (
            <p className="px-3 py-3 text-theme-sm text-gray-500">{loading ? "Pesquisando…" : `Nada encontrado para "${text.trim()}".`}</p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.label}</p>
                {g.items.map((it) => {
                  index++;
                  const i = index;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={it.open}
                      data-result={it.title}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left",
                        i === active ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/5",
                      )}
                    >
                      <span className="shrink-0 text-brand-500">{it.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{it.title}</span>
                        {it.detail && <span className="block truncate text-theme-xs text-gray-500">{it.detail}</span>}
                      </span>
                      {it.badge && (
                        <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
                          {it.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
