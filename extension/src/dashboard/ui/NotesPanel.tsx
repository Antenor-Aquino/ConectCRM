// Notas de um registro (cartão, contato, organização, atividade): escrever,
// editar, fixar, excluir. Links ficam clicáveis. Imagens coladas (Ctrl+V) ou
// arrastadas vão para o GED (tipo "Foto/imagem", vinculadas ao registro) e
// aparecem dentro da nota no lugar onde foram coladas.
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ImagePlus, Pencil, Pin, Trash2, X } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Note, NoteEntity } from "../../db/notes";
import { formatDateTime } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { createDocumentsFrom, fetchVersion } from "../../lib/documentFiles";
import { MAX_UPLOAD_BYTES } from "../../lib/files";
import { DocumentViewer } from "../documents/DocumentViewer";
import { FileTypeIcon } from "../documents/docUi";
import { LinkedText } from "./LinkedText";

type NoteDoc = Note["documents"][number];
/** Imagem no editor: nova (arquivo colado) ou já guardada no GED (docId). */
type EditorImage = { n: number; url: string | null; file?: File; docId?: string };

const MARKER_SPLIT = /(\[imagem:[\w-]+\])/;
const MARKER_ONE = /^\[imagem:([\w-]+)\]$/;
const pendingMarker = (n: number) => `[imagem ${n}]`;
const NOTE_IMAGE_MARKER = /\[imagem:([\w-]+)\]/g;

/** Imagem guardada no GED, mostrada dentro da nota (sem registrar visualização a cada vez). */
function NoteImage({ doc, onOpen }: { doc: NoteDoc; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    fetchVersion(doc.version_id, "inline")
      .then((f) => {
        objectUrl = URL.createObjectURL(f.blob);
        if (alive) setUrl(objectUrl);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.version_id]);
  if (failed) return <span className="text-theme-xs text-gray-400">[imagem indisponível: {doc.name}]</span>;
  return (
    <button type="button" title={`${doc.name} — abrir no GED`} onClick={onOpen} className="my-1 block cursor-zoom-in" data-note-image>
      {url ? (
        <img src={url} alt={doc.name} className="max-h-72 max-w-full rounded-lg border border-gray-200 object-contain dark:border-gray-700" />
      ) : (
        <span className="block h-24 w-40 animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
      )}
    </button>
  );
}

/** Texto da nota com links clicáveis e as imagens no lugar dos marcadores. */
function NoteBody({ note, onOpenDoc }: { note: Note; onOpenDoc: (id: string) => void }) {
  const docs = new Map(note.documents.map((d) => [d.id, d]));
  return (
    <div className="whitespace-pre-wrap break-words text-theme-sm text-gray-800 dark:text-white/90" data-note-body>
      {note.body.split(MARKER_SPLIT).map((part, i, all) => {
        const m = part.match(MARKER_ONE);
        if (!m) {
          // A imagem já ocupa a própria linha: tira a quebra de linha colada nela.
          let text = part;
          if (i > 0) text = text.replace(/^\n/, "");
          if (i < all.length - 1) text = text.replace(/\n$/, "");
          return <LinkedText key={i} text={text} />;
        }
        const d = docs.get(m[1]!);
        return d ? (
          <NoteImage key={i} doc={d} onOpen={() => onOpenDoc(d.id)} />
        ) : (
          <span key={i} className="text-theme-xs text-gray-400">
            [imagem excluída ou na lixeira]
          </span>
        );
      })}
    </div>
  );
}

/**
 * Campo da nota (nova ou edição). Imagens coladas ou arrastadas viram o
 * marcador "[imagem N]" no texto; ao salvar, as novas vão para o GED e o
 * marcador vira "[imagem:<documento>]". Devolve o texto e as imagens usadas.
 */
function NoteEditor({
  entityType,
  entityId,
  initial = "",
  docs = [],
  saveLabel,
  autoFocus,
  onSave,
  onCancel,
}: {
  entityType: NoteEntity;
  entityId: string;
  initial?: string;
  docs?: NoteDoc[];
  saveLabel: string;
  autoFocus?: boolean;
  onSave: (body: string, imageDocIds: string[]) => Promise<void>;
  onCancel?: () => void;
}) {
  const counter = useRef(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Imagens que a nota já tinha aparecem como "[imagem N]", iguais às novas.
  const [{ body: startBody, images: startImages }] = useState(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    const images: EditorImage[] = [];
    const body = initial.replace(NOTE_IMAGE_MARKER, (whole, id: string) => {
      if (!byId.has(id)) return whole;
      const n = ++counter.current;
      images.push({ n, url: null, docId: id });
      return pendingMarker(n);
    });
    return { body, images };
  });
  const [body, setBody] = useState(startBody);
  const [images, setImages] = useState<EditorImage[]>(startImages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Miniaturas das imagens que já estavam no GED.
  useEffect(() => {
    const urls: string[] = [];
    for (const img of startImages) {
      const d = docs.find((x) => x.id === img.docId);
      if (!d) continue;
      void fetchVersion(d.version_id, "inline")
        .then((f) => {
          const url = URL.createObjectURL(f.blob);
          urls.push(url);
          setImages((list) => list.map((x) => (x.n === img.n ? { ...x, url } : x)));
        })
        .catch(() => {});
    }
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Coloca as imagens no texto, onde está o cursor. Devolve false se não havia imagem. */
  const addImages = (files: File[]): boolean => {
    const picked = files.filter((f) => f.type.startsWith("image/"));
    if (!picked.length) return false;
    setError(null);
    if (picked.some((f) => f.size > MAX_UPLOAD_BYTES)) {
      setError("A imagem passa de 25 MB.");
      return true;
    }
    const added = picked.map((file) => ({ n: ++counter.current, file, url: URL.createObjectURL(file) }));
    const ta = textRef.current;
    const start = ta?.selectionStart ?? body.length;
    const end = ta?.selectionEnd ?? start;
    const before = body.slice(0, start);
    const rest = body.slice(end);
    const insert = `${before && !before.endsWith("\n") ? "\n" : ""}${added.map((a) => pendingMarker(a.n)).join("\n")}${rest.startsWith("\n") ? "" : "\n"}`;
    setBody(before + insert + rest);
    setImages((p) => [...p, ...added]);
    return true;
  };

  const remove = (img: EditorImage) => {
    if (img.file && img.url) URL.revokeObjectURL(img.url);
    setImages((list) => list.filter((x) => x.n !== img.n));
    setBody((b) => b.replace(`${pendingMarker(img.n)}\n`, "").replace(pendingMarker(img.n), ""));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let text = body;
      const ids: string[] = [];
      const used = images.filter((p) => text.includes(pendingMarker(p.n)));
      const fresh = used.filter((p) => p.file);
      let typeId: string | null = null;
      if (fresh.length) {
        const types = (await call("documentTypes.list", {})).filter((t) => t.active);
        typeId = (types.find((t) => t.name === "Foto/imagem") ?? types[0])?.id ?? null;
        if (!typeId) throw new Error("Cadastre um tipo de documento em Configurações → Documentos (GED) para guardar as imagens.");
      }
      const stamp = formatDateTime(new Date().toISOString());
      for (const p of used) {
        let docId = p.docId;
        if (!docId && p.file) {
          const name = `Imagem da nota - ${stamp}${fresh.length > 1 ? ` (${fresh.indexOf(p) + 1})` : ""}`;
          const ext = (p.file.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
          const file = new File([p.file], `${name.replace(/[\\/:*?"<>|]/g, "-")}.${ext}`, { type: p.file.type });
          docId = (await createDocumentsFrom([{ file, name }], typeId!, { type: entityType, id: entityId })).ids[0];
        }
        if (!docId) continue;
        text = text.split(pendingMarker(p.n)).join(`[imagem:${docId}]`);
        ids.push(docId);
      }
      await onSave(text, ids);
      images.forEach((p) => p.file && p.url && URL.revokeObjectURL(p.url));
      setImages([]);
      setBody("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-note-editor>
      <textarea
        ref={textRef}
        rows={3}
        autoFocus={autoFocus}
        className="w-full rounded-lg border border-warning-200 bg-warning-25 px-4 py-2.5 text-theme-sm text-gray-800 shadow-theme-xs outline-none placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        placeholder="Escreva uma nota… (cole ou arraste imagens aqui)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => addImages([...e.clipboardData.files]) && e.preventDefault()}
        onDrop={(e: DragEvent<HTMLTextAreaElement>) => addImages([...e.dataTransfer.files]) && e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
        style={autoFocus ? { minHeight: 120 } : undefined}
        aria-label={onCancel ? "Editar nota" : "Nova nota"}
      />
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" data-note-pending>
          {images.map((p) => (
            <div key={p.n} className="relative">
              {p.url ? (
                <img src={p.url} alt={`imagem ${p.n}`} className="h-16 w-24 rounded-md border border-gray-200 object-cover dark:border-gray-700" />
              ) : (
                <span className="block h-16 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-white/5" />
              )}
              <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white">imagem {p.n}</span>
              <button
                type="button"
                title={p.docId ? "Tirar da nota (o documento continua no GED)" : "Remover imagem"}
                onClick={() => remove(p)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-theme-xs text-gray-400">
          <ImagePlus size={13} /> Imagens coladas vão para o GED e aparecem na nota.
        </span>
        <span className="flex gap-2">
          {onCancel && (
            <TaButton size="sm" onClick={onCancel}>
              Cancelar
            </TaButton>
          )}
          <TaButton size={onCancel ? "sm" : undefined} variant="primary" disabled={!body.trim() || saving} onClick={() => void save()}>
            {saving ? "Salvando…" : saveLabel}
          </TaButton>
        </span>
      </div>
    </div>
  );
}

export function NotesPanel({
  entityType,
  entityId,
  onChanged,
  highlightId,
}: {
  entityType: NoteEntity;
  entityId: string;
  onChanged?: () => void;
  /** Nota aberta a partir do histórico: rola até ela e destaca. */
  highlightId?: string | null;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const load = useCallback(() => call("notes.list", { entityType, entityId }).then(setNotes), [entityId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!highlightId || !notes.length) return;
    listRef.current?.querySelector(`[data-note-id="${highlightId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, notes]);
  const after = async () => {
    await load();
    onChanged?.();
  };

  return (
    <div>
      <NoteEditor
        key={newKey}
        entityType={entityType}
        entityId={entityId}
        saveLabel="Salvar nota"
        onSave={async (body, imageIds) => {
          await call("notes.add", { entityType, entityId, body, documentIds: imageIds });
          setNewKey((k) => k + 1);
          await after();
        }}
      />
      <ul ref={listRef} className="mt-3 space-y-2">
        {notes.map((n) => {
          const inline = new Set([...n.body.matchAll(NOTE_IMAGE_MARKER)].map((m) => m[1]));
          const files = n.documents.filter((d) => !inline.has(d.id));
          return (
            <li
              key={n.id}
              data-note-id={n.id}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                n.id === highlightId ? "border-brand-400 bg-brand-25 ring-2 ring-brand-200 dark:bg-brand-500/10" : "border-gray-200 dark:border-gray-800",
              )}
            >
              {editingId === n.id ? (
                <NoteEditor
                  entityType={entityType}
                  entityId={entityId}
                  initial={n.body}
                  docs={n.documents}
                  saveLabel="Salvar"
                  autoFocus
                  onCancel={() => setEditingId(null)}
                  onSave={async (body, imageIds) => {
                    // Mantém os arquivos de origem (áudio, recorte) e troca as imagens da nota.
                    const keep = n.documents.filter((d) => !inline.has(d.id)).map((d) => d.id);
                    await call("notes.update", { id: n.id, patch: { body, documentIds: [...keep, ...imageIds] } });
                    setEditingId(null);
                    await after();
                  }}
                />
              ) : (
                <NoteBody note={n} onOpenDoc={setViewing} />
              )}
              {files.length > 0 && (
                // Arquivos de onde a nota veio (ex.: áudio transcrito, recorte): abre a prévia.
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-theme-xs text-gray-400">{files.length > 1 ? "Arquivos:" : "Arquivo:"}</span>
                  {files.map((d) => (
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
              {editingId !== n.id && (
                <div className="mt-2 flex items-center gap-3 text-theme-xs text-gray-400">
                  <span>
                    {formatDateTime(n.created_at)}
                    {n.edited_at && <span title={`Editada em ${formatDateTime(n.edited_at)}`}> · editada</span>}
                  </span>
                  <button type="button" className="ml-auto hover:text-brand-600" title="Editar" aria-label="Editar nota" onClick={() => setEditingId(n.id)}>
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className={cn("hover:text-brand-600", n.pinned && "text-brand-600")}
                    title={n.pinned ? "Desafixar" : "Fixar"}
                    onClick={async () => {
                      await call("notes.update", { id: n.id, patch: { pinned: !n.pinned } });
                      await after();
                    }}
                  >
                    <Pin size={14} />
                  </button>
                  <button
                    type="button"
                    className="hover:text-error-600"
                    title="Excluir"
                    onClick={async () => {
                      if (!confirm("Excluir esta nota? Vai para a lixeira, de onde pode ser restaurado.")) return;
                      await call("notes.delete", { id: n.id });
                      await after();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {notes.length === 0 && <p className="text-theme-sm text-gray-400">Nenhuma nota.</p>}
      </ul>
      {viewing && <DocumentViewer documentId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
