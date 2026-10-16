// Aba "Anexos" do cartão: arquivos enviados pelo CRM ou pelo popup do
// WhatsApp (recortes de tela, áudios, documentos).
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Music, Paperclip, Trash2 } from "lucide-react";
import { TaButton } from "@tailadmin";
import { call } from "../../rpc/client";
import type { AttachmentInfo } from "../../db/attachments";
import { downloadDataUrl, fileToDataUrl, formatBytes, MAX_UPLOAD_BYTES } from "../../lib/files";
import { formatDateTime } from "../../lib/format";
import { ErrorText } from "./form";

export function AttachmentsPanel({ dealId, onChanged }: { dealId: string; onChanged?: () => void }) {
  const [list, setList] = useState<AttachmentInfo[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const items = await call("attachments.list", { entityType: "deal", entityId: dealId });
    setList(items);
    const images = items.filter((a) => a.mime.startsWith("image/") && a.size_bytes <= 2 * 1024 * 1024).map((a) => a.id);
    setThumbs(images.length ? await call("attachments.dataUrls", { ids: images }) : {});
  }, [dealId]);
  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const f of files) {
        if (f.size > MAX_UPLOAD_BYTES) throw new Error(`"${f.name}" passa de 25 MB.`);
        await call("attachments.add", { entityType: "deal", entityId: dealId, filename: f.name, dataUrl: await fileToDataUrl(f) });
      }
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <TaButton variant="primary" disabled={busy} startIcon={<Paperclip size={15} />} onClick={() => input.current?.click()}>
        {busy ? "Enviando…" : "Anexar arquivos"}
      </TaButton>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void upload(files);
        }}
      />
      <ErrorText>{error}</ErrorText>
      <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-gray-500 dark:bg-white/5">
              {thumbs[a.id] ? (
                <img src={thumbs[a.id]} alt="" className="h-full w-full object-cover" />
              ) : a.mime.startsWith("audio/") ? (
                <Music size={18} />
              ) : (
                <FileText size={18} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-theme-sm text-gray-800 dark:text-white/90">{a.filename}</span>
              <span className="block text-theme-xs text-gray-400">
                {formatBytes(a.size_bytes)} · {formatDateTime(a.created_at)}
                {a.created_by_name && ` · ${a.created_by_name}`}
              </span>
            </span>
            <button
              type="button"
              title="Baixar"
              className="text-gray-400 hover:text-brand-600"
              onClick={async () => {
                const url = await call("attachments.get", { id: a.id });
                if (url) downloadDataUrl(url, a.filename);
              }}
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              title="Excluir"
              className="text-gray-400 hover:text-error-600"
              onClick={async () => {
                if (!confirm(`Excluir o anexo "${a.filename}"?`)) return;
                await call("attachments.delete", { id: a.id });
                await load();
                onChanged?.();
              }}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
        {list.length === 0 && <p className="py-2 text-theme-sm text-gray-400">Nenhum anexo. Envie arquivos aqui ou pelo popup do WhatsApp.</p>}
      </ul>
    </div>
  );
}
