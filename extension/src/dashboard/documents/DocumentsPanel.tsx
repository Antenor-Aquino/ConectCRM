// Aba "Documentos" de um cadastro (cartão, tarefa, contato, organização):
// os documentos do GED vinculados a ele. Anexar abre a janela Novo
// documento já com os vínculos da tela; "Remover deste cadastro" tira só o
// vínculo; a lixeira tira o documento de todos os cadastros.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, Paperclip, Trash2, Unlink } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { DocLinkType, DocumentListItem } from "../../db/documents";
import { downloadVersion } from "../../lib/documentFiles";
import { formatBytes } from "../../lib/files";
import { formatDateTime } from "../../lib/format";
import { useSession } from "../session";
import { DocumentViewer } from "./DocumentViewer";
import { FileTypeIcon, LinkChip, RestrictedBadge, TypeBadge, ValidityBadge } from "./docUi";
import { UploadModal } from "./UploadModal";
import { errorText } from "../../lib/errors";

const NOUN: Record<DocLinkType, string> = { deal: "deste cartão", activity: "desta atividade", person: "deste contato", organization: "desta organização" };

export function DocumentsPanel({ type, id, onChanged, compact }: { type: DocLinkType; id: string; onChanged?: () => void; compact?: boolean }) {
  const { user } = useSession();
  const [list, setList] = useState<DocumentListItem[]>([]);
  const [upload, setUpload] = useState<File[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => setList(await call("documents.forEntity", { type, id })), [type, id]);
  useEffect(() => {
    void load();
  }, [load]);
  const changed = async () => {
    await load();
    onChanged?.();
  };
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await changed();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) setUpload([...e.dataTransfer.files]);
      }}
      className={cn("rounded-xl", drag && "outline-2 outline-dashed outline-brand-400")}
    >
      <div className={cn("flex items-center gap-2", compact ? "mb-1.5 justify-between" : "mb-3")}>
        {compact ? (
          <>
            <span className="text-theme-xs font-semibold uppercase tracking-wide text-gray-400">Documentos</span>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex items-center gap-1 text-theme-xs font-medium text-brand-600 hover:underline"
            >
              <Paperclip size={13} /> Anexar documentos
            </button>
          </>
        ) : (
          <>
            <TaButton variant="primary" startIcon={<Paperclip size={15} />} onClick={() => input.current?.click()}>
              Anexar documentos
            </TaButton>
            <span className="text-theme-xs text-gray-400">ou arraste os arquivos para cá</span>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) setUpload(files);
        }}
      />
      {error && <p className="mb-2 rounded-lg bg-error-50 px-3 py-2 text-theme-xs text-error-700">{error}</p>}
      <ul className={cn("divide-y divide-gray-100 dark:divide-gray-800", compact && "rounded-lg bg-gray-50 px-2.5 dark:bg-white/5")}>
        {list.map((d) => {
          const others = d.links.filter((l) => !(l.type === type && l.id === id));
          const canManage = user.role !== "vendedor" || d.created_by === user.id;
          return (
            <li key={d.id} className={cn("flex items-start gap-3", compact ? "py-1.5" : "py-2.5")}>
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-gray-900">
                <FileTypeIcon mime={d.mime} />
              </span>
              <span className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setOpen(d.id)}
                  className="block max-w-full truncate text-left text-theme-sm font-medium text-gray-800 hover:text-brand-600 dark:text-white/90"
                >
                  {d.name}
                </button>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <TypeBadge name={d.type_name} color={d.type_color} />
                  <ValidityBadge validUntil={d.valid_until} />
                  {!!d.restricted && <RestrictedBadge />}
                  <span className="text-theme-xs text-gray-400">
                    {d.filename} · {formatBytes(d.size_bytes)}
                    {d.versions > 1 && ` · v${d.version_number}`}
                    {!compact && ` · ${formatDateTime(d.created_at)}${d.created_by_name ? ` · ${d.created_by_name}` : ""}`}
                  </span>
                </span>
                {others.length > 0 && !compact && (
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-theme-xs text-gray-400">Também em:</span>
                    {others.map((l) => (
                      <LinkChip key={`${l.type}:${l.id}`} link={l} />
                    ))}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2 pt-1">
                <button type="button" title="Visualizar" className="text-gray-400 hover:text-brand-600" onClick={() => setOpen(d.id)}>
                  <Eye size={16} />
                </button>
                <button
                  type="button"
                  title={`Baixar ${d.filename}`}
                  className="text-gray-400 hover:text-brand-600"
                  onClick={() => void run(() => downloadVersion(d.version_id))}
                >
                  <Download size={16} />
                </button>
                <button
                  type="button"
                  title={`Remover ${NOUN[type]} (continua no GED e nos outros cadastros)`}
                  className="text-gray-400 hover:text-warning-600"
                  onClick={() =>
                    confirm(
                      `Remover "${d.name}" ${NOUN[type]}?\n\nO documento continua no GED${others.length ? ` e em ${others.length} outro(s) cadastro(s)` : ""}.`,
                    ) && void run(() => call("documents.removeLink", { id: d.id, type, entityId: id }))
                  }
                >
                  <Unlink size={16} />
                </button>
                {canManage && (
                  <button
                    type="button"
                    title="Mover para a lixeira (sai de todos os cadastros)"
                    className="text-gray-400 hover:text-error-600"
                    onClick={() =>
                      confirm(
                        `Mover "${d.name}" para a lixeira?\n\nEle sai de TODOS os cadastros${others.length ? ` (inclusive de ${others.length} outro(s))` : ""}. Pode ser restaurado pela Lixeira dentro do prazo.`,
                      ) && void run(() => call("documents.trash", { ids: [d.id] }))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
        {list.length === 0 && <li className="py-2 text-theme-sm text-gray-400">Nenhum documento.</li>}
      </ul>
      {upload && (
        <UploadModal
          files={upload}
          context={{ type, id }}
          onClose={() => setUpload(null)}
          onSaved={() => {
            setUpload(null);
            void changed();
          }}
        />
      )}
      {open && <DocumentViewer documentId={open} onClose={() => setOpen(null)} onChanged={() => void changed()} />}
    </div>
  );
}
