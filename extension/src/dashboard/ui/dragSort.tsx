// Ordenar por arrastar e soltar (todo o sistema): segure a alça ⠿ e solte na
// posição desejada. A alça também aceita o teclado (setas ↑/↓), para quem não
// usa o mouse. Só a alça inicia o arrasto (campos de texto na linha seguem
// editáveis e selecionáveis).
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@tailadmin";

/** Move o item de `from` para a posição `to` (índices). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const c = [...list];
  const [it] = c.splice(from, 1);
  c.splice(to, 0, it!);
  return c;
}

/** Ordem nova de chaves: `from` vai para onde está `to`. */
export function moveKey(keys: string[], from: string, to: string): string[] {
  return moveItem(keys, keys.indexOf(from), keys.indexOf(to));
}

export function useDragSort(opts: {
  /** Soltou `from` sobre `to` (ou teclado: vizinho). */
  onMove: (from: string, to: string) => void;
  /** Pode soltar aqui? (ex.: só dentro da mesma categoria) */
  canDrop?: (from: string, to: string) => boolean;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ok = (to: string) => !!dragging && dragging !== to && (opts.canDrop?.(dragging, to) ?? true);
  const end = () => {
    setArmed(null);
    setDragging(null);
    setOver(null);
  };
  return {
    dragging,
    /** Na linha (li, tr, div). */
    rowProps: (key: string) => ({
      draggable: armed === key,
      "data-drag-row": key,
      onDragStart: (e: DragEvent) => {
        if (armed !== key) return e.preventDefault();
        setDragging(key);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", key);
      },
      onDragOver: (e: DragEvent) => {
        if (!ok(key)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== key) setOver(key);
      },
      onDragLeave: () => over === key && setOver(null),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (ok(key)) opts.onMove(dragging!, key);
        end();
      },
      onDragEnd: end,
      className: cn(dragging === key && "opacity-40", over === key && "outline outline-2 -outline-offset-2 outline-brand-400"),
    }),
    /** Na alça (⠿): arma o arrasto e aceita ↑/↓ no teclado. */
    handleProps: (key: string, prev?: string | null, next?: string | null) => ({
      onMouseDown: () => setArmed(key),
      onMouseUp: () => !dragging && setArmed(null),
      onTouchStart: () => setArmed(key),
      onKeyDown: (e: KeyboardEvent) => {
        const to = e.key === "ArrowUp" ? prev : e.key === "ArrowDown" ? next : null;
        if (!to || (opts.canDrop && !opts.canDrop(key, to))) return;
        e.preventDefault();
        opts.onMove(key, to);
      },
    }),
  };
}

/** Alça de arrastar (⠿). */
export function DragHandle({ className, label = "Arraste para mudar a ordem (ou use ↑/↓ do teclado)", ...props }: ReturnType<ReturnType<typeof useDragSort>["handleProps"]> & { className?: string; label?: string }) {
  return (
    <button type="button" title={label} aria-label={label} className={cn("cursor-grab touch-none text-gray-300 hover:text-gray-600 active:cursor-grabbing dark:text-gray-600", className)} data-drag-handle {...props}>
      <GripVertical size={15} />
    </button>
  );
}
