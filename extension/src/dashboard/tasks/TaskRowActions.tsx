// Botões de uma atividade nas listas (cartão, tela de Atividades, fichas de
// contato e organização): Duplicar (abre uma atividade nova igual, para
// ajustar) e Lixeira (vai para a lixeira, com Restaurar; recorrente pergunta
// o alcance).
import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { call } from "../../rpc/client";
import { ScopeDialog } from "./RecurrenceEditor";

export function TaskRowActions({
  task,
  onDuplicate,
  onDeleted,
}: {
  task: { id: string; series_id?: string | null };
  /** Abrir a janela "Nova atividade (cópia)". */
  onDuplicate: () => void;
  onDeleted: () => void;
}) {
  const [askScope, setAskScope] = useState(false);
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        title="Duplicar: abre uma atividade nova igual a esta, para você ajustar"
        aria-label="Duplicar"
        data-task-duplicate={task.id}
        onClick={onDuplicate}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-white/5"
      >
        <Copy size={16} />
      </button>
      <button
        type="button"
        title="Excluir (vai para a lixeira, de onde pode ser restaurada)"
        aria-label="Excluir"
        data-task-delete={task.id}
        onClick={async () => {
          if (task.series_id) return setAskScope(true);
          if (!confirm("Excluir esta atividade? Vai para a lixeira, de onde pode ser restaurado.")) return;
          await call("activities.delete", { id: task.id });
          onDeleted();
        }}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-500/10"
      >
        <Trash2 size={16} />
      </button>
      {askScope && (
        <ScopeDialog
          action="delete"
          onClose={() => setAskScope(false)}
          onChoose={async (scope) => {
            setAskScope(false);
            await call("activities.delete", { id: task.id, scope });
            onDeleted();
          }}
        />
      )}
    </span>
  );
}
