// Aviso de cadastro parecido (anti-duplicidade) nos formulários de criação:
// aparece enquanto digita e, se ninguém confirmou, segura o "Salvar" e
// pergunta se é para abrir o existente ou criar mesmo assim.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@tailadmin";
import type { SimilarItem } from "../../db/similar";

export interface SimilarState<T extends SimilarItem> {
  items: T[];
  /** Usuário tentou salvar com itens não confirmados. */
  asking: boolean;
  /** Consulta de novo (o texto pode ter mudado agora): true = pode salvar; false = mostrou a pergunta. */
  confirm: () => Promise<boolean>;
  acknowledge: () => void;
}

/** Busca (com espera de 350 ms) os parecidos de `key`; `enabled` desliga na edição. */
export function useSimilar<T extends SimilarItem>(key: string, fetch: () => Promise<T[]>, enabled = true): SimilarState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [asking, setAsking] = useState(false);
  const ok = useRef(new Set<string>());
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      ok.current = new Set();
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      fetchRef.current().then(
        (r) => alive && setItems(r),
        () => alive && setItems([]),
      );
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, enabled]);

  const pending = items.some((i) => !ok.current.has(i.id));
  useEffect(() => {
    if (!pending) setAsking(false);
  }, [pending]);

  return {
    items,
    asking: asking && pending,
    confirm: async () => {
      const fresh = enabled ? await fetchRef.current().catch(() => [] as T[]) : [];
      setItems(fresh);
      if (fresh.every((i) => ok.current.has(i.id))) return true;
      setAsking(true);
      return false;
    },
    acknowledge: () => {
      for (const i of items) ok.current.add(i.id);
      setAsking(false);
    },
  };
}

export function SimilarNotice<T extends SimilarItem>({
  state,
  openLabel = "Abrir",
  onOpen,
  onContinue,
  reasonText,
}: {
  state: SimilarState<T>;
  openLabel?: string;
  onOpen?: (item: T) => void;
  /** "Criar mesmo assim" (salva em seguida). */
  onContinue: () => void;
  /** Texto da semelhança (padrão: "nn% parecido"). */
  reasonText?: (item: T) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Ao segurar o "Salvar", traz o aviso para a vista (fica no topo do formulário).
  useEffect(() => {
    if (state.asking) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state.asking]);
  if (!state.items.length) return null;
  return (
    <div
      ref={ref}
      data-testid="similar-notice"
      className={cn(
        "mb-3 rounded-lg border p-3 text-theme-sm",
        state.asking ? "border-warning-400 bg-warning-50" : "border-warning-200 bg-warning-25 dark:bg-warning-500/10",
      )}
    >
      <p className="flex items-center gap-1.5 font-medium text-warning-800 dark:text-warning-400">
        <AlertTriangle size={15} className="shrink-0" />
        {state.asking
          ? "Possível duplicidade. Abra o cadastro existente ou confirme para criar mesmo assim."
          : "Possível duplicidade: já existe cadastro parecido."}
      </p>
      <ul className="mt-2 space-y-1.5">
        {state.items.map((i) => (
          <li key={i.id} className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 dark:bg-gray-900">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-800 dark:text-white/90">{i.name}</p>
              <p className="truncate text-theme-xs text-gray-500">{[reasonText ? reasonText(i) : `${i.score}% parecido`, ...i.details].join(" · ")}</p>
            </div>
            {onOpen && (
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 text-theme-xs font-medium text-brand-600 hover:underline"
                onClick={() => onOpen(i)}
              >
                <ExternalLink size={12} /> {openLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className={cn(
            "rounded-md px-2.5 py-1 text-theme-xs font-medium",
            state.asking ? "bg-warning-500 text-white hover:bg-warning-600" : "text-warning-700 hover:underline",
          )}
          onClick={() => {
            state.acknowledge();
            if (state.asking) onContinue();
          }}
        >
          {state.asking ? "Criar mesmo assim" : "Não é o mesmo, continuar"}
        </button>
      </div>
    </div>
  );
}
