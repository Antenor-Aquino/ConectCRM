// Aviso depois de cada exclusão (spec 11): "... enviado para a lixeira. Pode
// ser restaurado em até N dias; depois será excluído definitivamente." com
// Restaurar (desfaz na hora) e Ver lixeira.
import { useEffect, useRef, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { call, DATA_CHANGED_EVENT, TRASH_EVENT } from "../../rpc/client";
import type { TrashNotice } from "../../db/trash";
import { errorText } from "../../lib/errors";

type Toast = { notice: TrashNotice; state: "trashed" | "restoring" | "restored" | "error"; message?: string };

export function TrashToaster({ onOpenTrash }: { onOpenTrash: () => void }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const hideLater = (ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), ms);
  };

  useEffect(() => {
    const on = (e: Event) => {
      setToast({ notice: (e as CustomEvent<TrashNotice>).detail, state: "trashed" });
      hideLater(12_000);
    };
    window.addEventListener(TRASH_EVENT, on);
    return () => window.removeEventListener(TRASH_EVENT, on);
  }, []);

  if (!toast) return null;
  const { notice } = toast;
  const plural = /^\d/.test(notice.label);

  const undo = async () => {
    window.clearTimeout(timer.current);
    setToast({ ...toast, state: "restoring" });
    try {
      const r = await call("trash.restore", { ids: notice.ids });
      if (r.errors.length) throw new Error(r.errors[0]!.message);
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
      setToast({ ...toast, state: "restored" });
      hideLater(4000);
    } catch (e) {
      setToast({ ...toast, state: "error", message: errorText(e) });
    }
  };

  return (
    <div
      role="status"
      data-trash-toast
      className="fixed bottom-5 left-1/2 z-[100000] flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-start gap-3 rounded-xl bg-gray-900 px-4 py-3 text-theme-sm text-white shadow-theme-lg dark:bg-gray-800"
    >
      <Trash2 size={18} className="mt-0.5 shrink-0 text-gray-300" />
      <div className="min-w-0 flex-1">
        {toast.state === "restored" ? (
          <p>
            {notice.label} {plural ? "foram restaurados" : "— restaurado"}.
          </p>
        ) : toast.state === "error" ? (
          <p className="text-error-300">Não foi possível restaurar: {toast.message}</p>
        ) : (
          <p>
            <b className="font-semibold">{notice.label}</b> {plural ? "foram enviados" : "— enviado"} para a lixeira. Pode{plural ? "m" : ""} ser restaurado
            {plural ? "s" : ""} em até {notice.days} dia{notice.days === 1 ? "" : "s"}; depois {plural ? "serão excluídos" : "será excluído"} definitivamente.
          </p>
        )}
        {toast.state !== "restored" && (
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              disabled={toast.state === "restoring"}
              onClick={() => void undo()}
              className="inline-flex items-center gap-1 font-semibold text-brand-300 hover:text-brand-200 disabled:opacity-60"
            >
              <RotateCcw size={14} /> {toast.state === "restoring" ? "Restaurando…" : "Restaurar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setToast(null);
                onOpenTrash();
              }}
              className="font-medium text-gray-300 hover:text-white"
            >
              Ver lixeira
            </button>
          </div>
        )}
      </div>
      <button type="button" title="Fechar" onClick={() => setToast(null)} className="text-gray-400 hover:text-white">
        <X size={16} />
      </button>
    </div>
  );
}
