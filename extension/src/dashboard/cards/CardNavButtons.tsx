// Anterior/Próximo no cartão aberto: percorre os cartões na ordem do quadro ou da lista (com os filtros).
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Navegação entre os cartões do quadro/lista (na ordem em que aparecem, com os filtros). */
export interface CardNav {
  /** Posição do cartão aberto (1 = primeiro) e total de cartões. */
  pos: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
}

const BTN =
  "flex h-8 items-center gap-1 rounded-lg bg-gray-100 px-2 text-theme-xs font-medium text-gray-600 hover:bg-gray-200 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-100 disabled:hover:text-gray-600 dark:bg-white/5 dark:text-gray-300";

export function CardNavButtons({ nav }: { nav: CardNav }) {
  if (nav.total < 2) return null;
  return (
    <div className="flex items-center gap-1" data-card-nav>
      <button type="button" onClick={nav.onPrev} disabled={!nav.onPrev} title="Cartão anterior" aria-label="Cartão anterior" data-card-prev className={BTN}>
        <ChevronLeft size={16} /> Anterior
      </button>
      <span className="min-w-[4.5rem] text-center text-theme-xs tabular-nums text-gray-500" data-card-pos>
        {nav.pos} de {nav.total}
      </span>
      <button type="button" onClick={nav.onNext} disabled={!nav.onNext} title="Próximo cartão" aria-label="Próximo cartão" data-card-next className={BTN}>
        Próximo <ChevronRight size={16} />
      </button>
    </div>
  );
}
