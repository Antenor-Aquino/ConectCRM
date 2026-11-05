import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Leaf, MoreHorizontal } from "lucide-react";
import { cn } from "../utils/cn";

export interface TopNavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export function TopNavBar({
  items,
  overflowItems = [],
  activeId,
  onSelect,
  actions,
  demoMode = false,
  extraLinks,
  brandName = "ConectCRM",
  brandIcon = <Leaf size={16} />,
  beforeNavEnd,
  search,
  actionItems = [],
}: {
  items: TopNavItem[];
  overflowItems?: TopNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  actions?: ReactNode;
  demoMode?: boolean;
  extraLinks?: ReactNode;
  /** Nome do sistema exibido ao lado do ícone. */
  brandName?: string;
  brandIcon?: ReactNode;
  /** Conteúdo logo após os itens do menu (ex.: botão "+" de cadastro rápido). */
  beforeNavEnd?: ReactNode;
  /** Pesquisa geral, entre o menu e as ações (fora do nav rolável, para o dropdown não ser cortado). */
  search?: ReactNode;
  /** Telas abertas por botões em `actions` (ex.: Configurações): só para o subtítulo. */
  actionItems?: TopNavItem[];
}) {
  const active = [...items, ...overflowItems, ...actionItems].find((t) => t.id === activeId);

  // Menu que se ajusta à largura: o que não cabe vai para "Mais" (na mesma ordem).
  // Os itens são medidos numa fileira invisível; o "+" (beforeNavEnd) fica sempre à vista.
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(items.length);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const calc = () => {
      const widths = [...measure.children].map((c) => (c as HTMLElement).offsetWidth + 2);
      const end = endRef.current?.offsetWidth ?? 0;
      const room = nav.clientWidth - end;
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= room && !overflowItems.length) return setFit(items.length);
      const more = 90; // botão "Mais"
      let used = 0;
      let k = 0;
      while (k < widths.length && used + widths[k]! <= room - more) used += widths[k++]!;
      setFit(k);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(nav.parentElement ?? nav);
    return () => ro.disconnect();
  }, [items, overflowItems.length]);
  const shown = items.slice(0, fit);
  const moreItems = [...items.slice(fit), ...overflowItems];

  return (
    <header
      className={cn(
        "sticky top-0 z-[100] border-b border-brand-100 bg-[#f5f7ff] shadow-theme-xs dark:border-gray-800 dark:bg-gray-900",
        demoMode && "border-b-warning-400",
      )}
    >
      <div className="flex h-[56px] items-center gap-2 px-3 md:gap-3 md:px-5">
        {/* Marca */}
        <div className="flex shrink-0 items-center gap-2 pr-2 md:pr-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white">
            {brandIcon}
          </span>
          <div className="hidden min-w-0 sm:block">
            <div className="truncate text-sm font-bold leading-tight text-gray-900 dark:text-white/90">{brandName}</div>
            <div className="truncate text-[11px] leading-tight text-gray-500">
              {active?.label ?? "Painel"}
              {demoMode && (
                <span className="ml-1.5 inline-flex rounded-full bg-warning-500 px-1.5 py-px text-[9px] font-bold uppercase text-white">
                  Teste
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Menu principal — mesma linha que Guia/Ajuda */}
        <nav
          ref={navRef}
          className="relative flex min-w-0 flex-1 items-center gap-0.5"
          aria-label="Menu principal"
        >
          {/* Fileira invisível só para medir a largura de cada item. */}
          <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex gap-0.5">
            {items.map((item) => (
              <span key={item.id} className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium md:px-3 md:py-2 md:text-theme-sm">
                <span className="flex shrink-0 [&_svg]:size-4">{item.icon}</span>
                <span className="whitespace-nowrap">{item.label}</span>
              </span>
            ))}
          </div>
          {shown.map((item) => {
            const isActive = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors md:px-3 md:py-2 md:text-theme-sm",
                  isActive
                    ? "bg-white text-brand-600 shadow-theme-xs dark:bg-brand-500/15 dark:text-brand-400"
                    : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5",
                )}
              >
                <span className="flex shrink-0 [&_svg]:size-4">{item.icon}</span>
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
          {moreItems.length > 0 && <TopNavOverflow items={moreItems} activeId={activeId} onSelect={onSelect} />}
          <span ref={endRef} className="flex shrink-0 items-center">
            {beforeNavEnd}
          </span>
        </nav>

        {search}


        {/* Guia, Ajuda, ambiente, notificações */}
        <div className="flex shrink-0 items-center gap-1.5 border-l border-gray-200 pl-2 md:gap-2 md:pl-3 dark:border-gray-700">
          {extraLinks}
          {actions}
        </div>
      </div>
    </header>
  );
}

function TopNavOverflow({
  items,
  activeId,
  onSelect,
}: {
  items: TopNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasActive = items.some((i) => i.id === activeId);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium md:px-3 md:py-2 md:text-theme-sm",
          hasActive
            ? "bg-white text-brand-600 shadow-theme-xs dark:bg-brand-500/15 dark:text-brand-400"
            : "text-gray-600 hover:bg-gray-100 dark:text-gray-400",
        )}
      >
        <MoreHorizontal size={16} />
        <span className="whitespace-nowrap">Mais</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[200px] rounded-xl border border-gray-200 bg-white py-1 shadow-theme-md dark:border-gray-700 dark:bg-gray-900">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-theme-sm",
                  item.id === activeId
                    ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15"
                    : "text-gray-700 hover:bg-gray-50 dark:text-gray-300",
                )}
              >
                <span className="[&_svg]:size-4">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
