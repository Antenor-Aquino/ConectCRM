// Notas de um registro (cartão, contato, organização): escrever, fixar, excluir.
import { useCallback, useEffect, useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import { TaButton, TaTextarea, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Note, NoteEntity } from "../../db/notes";
import { formatDateTime } from "../../lib/format";

export function NotesPanel({ entityType, entityId, onChanged }: { entityType: NoteEntity; entityId: string; onChanged?: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const load = useCallback(() => call("notes.list", { entityType, entityId }).then(setNotes), [entityId]);
  useEffect(() => {
    void load();
  }, [load]);
  const after = async () => {
    await load();
    onChanged?.();
  };
  return (
    <div>
      <TaTextarea rows={3} className="bg-warning-25 border-warning-200" placeholder="Escreva uma nota…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-2 flex justify-end">
        <TaButton
          variant="primary"
          disabled={!body.trim()}
          onClick={async () => {
            await call("notes.add", { entityType, entityId, body });
            setBody("");
            await after();
          }}
        >
          Salvar nota
        </TaButton>
      </div>
      <ul className="mt-3 space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <p className="whitespace-pre-wrap text-theme-sm text-gray-800 dark:text-white/90">{n.body}</p>
            <div className="mt-2 flex items-center gap-3 text-theme-xs text-gray-400">
              <span>{formatDateTime(n.created_at)}</span>
              <button type="button" className={cn("ml-auto hover:text-brand-600", n.pinned && "text-brand-600")} title={n.pinned ? "Desafixar" : "Fixar"} onClick={async () => {
                await call("notes.update", { id: n.id, patch: { pinned: !n.pinned } });
                await after();
              }}>
                <Pin size={14} />
              </button>
              <button type="button" className="hover:text-error-600" title="Excluir" onClick={async () => {
                if (!confirm("Excluir esta nota?")) return;
                await call("notes.delete", { id: n.id });
                await after();
              }}>
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
        {notes.length === 0 && <p className="text-theme-sm text-gray-400">Nenhuma nota.</p>}
      </ul>
    </div>
  );
}

