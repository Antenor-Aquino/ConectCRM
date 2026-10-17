// Notas de um registro (cartão, contato, organização): escrever, fixar, excluir.
import { useCallback, useEffect, useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import { TaButton, TaTextarea, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Note, NoteEntity } from "../../db/notes";
import { formatDateTime } from "../../lib/format";
import { DocumentViewer } from "../documents/DocumentViewer";
import { FileTypeIcon } from "../documents/docUi";

export function NotesPanel({ entityType, entityId, onChanged }: { entityType: NoteEntity; entityId: string; onChanged?: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
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
            {n.documents.length > 0 && (
              // Arquivos de onde a nota veio (ex.: áudio transcrito, recorte): abre a prévia.
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-theme-xs text-gray-400">{n.documents.length > 1 ? "Arquivos:" : "Arquivo:"}</span>
                {n.documents.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    title={`Ver ${d.filename}`}
                    onClick={() => setViewing(d.id)}
                    className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-theme-xs text-gray-700 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                  >
                    <FileTypeIcon mime={d.mime} size={13} />
                    <span className="truncate">{d.name}</span>
                  </button>
                ))}
              </div>
            )}
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
      {viewing && <DocumentViewer documentId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

