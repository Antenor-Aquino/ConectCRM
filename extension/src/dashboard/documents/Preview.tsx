// Prévia do documento antes de baixar: PDF (páginas com zoom), imagem
// (ajustar/tamanho real) e texto. Pede o acesso à pasta quando preciso.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, KeyRound, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { TaButton, cn } from "@tailadmin";
import { fetchVersion, isImage, isPdf } from "../../lib/documentFiles";
import { FolderAccessError, requestDocumentsFolderAccess } from "../../lib/fileStore";
import { closePdf, loadPdf, renderPdfPage } from "../../lib/pdf";
import { errorText } from "../../lib/errors";

const TEXT_LIMIT = 200_000;

function PdfView({ blob }: { blob: Blob }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    loadPdf(blob)
      .then((d) => {
        loaded = d;
        if (alive) setDoc(d);
        else closePdf(d);
      })
      .catch(() => alive && setError("Não foi possível abrir este PDF."));
    return () => {
      alive = false;
      if (loaded) closePdf(loaded);
    };
  }, [blob]);

  useEffect(() => {
    if (!doc || !canvas.current || !box.current) return;
    void renderPdfPage(doc, page, canvas.current, box.current.clientWidth - 24, zoom).catch((e: unknown) => {
      console.error("ConectCRM: falha ao desenhar o PDF", e);
      setError("Falha ao desenhar a página.");
    });
  }, [doc, page, zoom]);

  if (error) return <p className="p-6 text-center text-theme-sm text-error-600">{error}</p>;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-center gap-2 border-b border-gray-200 py-1.5 text-theme-xs text-gray-600 dark:border-gray-800 dark:text-gray-300">
        <button
          type="button"
          title="Página anterior"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/5"
        >
          <ChevronLeft size={16} />
        </button>
        <span data-testid="pdf-page">
          Página {page} de {doc?.numPages ?? "…"}
        </span>
        <button
          type="button"
          title="Próxima página"
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/5"
        >
          <ChevronRight size={16} />
        </button>
        <span className="mx-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />
        <button
          type="button"
          title="Diminuir"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/5"
        >
          <ZoomOut size={16} />
        </button>
        <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          title="Aumentar"
          disabled={zoom >= 3}
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/5"
        >
          <ZoomIn size={16} />
        </button>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto bg-gray-100 p-3 dark:bg-gray-950">
        {!doc && (
          <div className="flex h-40 items-center justify-center text-gray-400">
            <Loader2 className="animate-spin" />
          </div>
        )}
        <canvas ref={canvas} className="mx-auto bg-white shadow-theme-md" />
      </div>
    </div>
  );
}

function ImageView({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  const [actual, setActual] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-center gap-2 border-b border-gray-200 py-1.5 text-theme-xs dark:border-gray-800">
        <button
          type="button"
          onClick={() => setActual((a) => !a)}
          className="flex items-center gap-1 rounded px-2 py-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
        >
          {actual ? <ZoomOut size={15} /> : <ZoomIn size={15} />} {actual ? "Ajustar à tela" : "Tamanho real"}
        </button>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto bg-gray-100 p-3 dark:bg-gray-950", !actual && "flex items-center justify-center")}>
        {url && <img src={url} alt="Prévia" className={cn(actual ? "max-w-none" : "max-h-full max-w-full object-contain", "shadow-theme-md")} />}
      </div>
    </div>
  );
}

function TextView({ blob }: { blob: Blob }) {
  const [text, setText] = useState("");
  useEffect(() => {
    void blob
      .slice(0, TEXT_LIMIT)
      .text()
      .then((t) => setText(blob.size > TEXT_LIMIT ? `${t}\n…` : t));
  }, [blob]);
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap bg-gray-50 p-4 font-mono text-theme-xs text-gray-700 dark:bg-gray-950 dark:text-gray-300">
      {text}
    </pre>
  );
}

export const canPreview = (mime: string, filename = "") =>
  isPdf({ mime, filename }) || isImage({ mime }) || /^text\//.test(mime) || mime === "application/json";

/** Prévia de uma versão (registra a visualização na auditoria). */
export function Preview({ versionId, mime, filename }: { versionId: string; mime: string; filename: string }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<{ text: string; access?: boolean } | null>(null);
  const load = useCallback(async () => {
    setError(null);
    setBlob(null);
    if (!canPreview(mime, filename)) return;
    try {
      setBlob((await fetchVersion(versionId, "view")).blob);
    } catch (e) {
      setError({ text: errorText(e), access: e instanceof FolderAccessError });
    }
  }, [versionId, mime, filename]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!canPreview(mime, filename)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-theme-sm text-gray-500">
        Prévia indisponível para este tipo de arquivo. Use “Baixar”.
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-theme-sm text-error-600">
        {error.text}
        {error.access && (
          <TaButton
            size="sm"
            variant="primary"
            startIcon={<KeyRound size={14} />}
            onClick={() =>
              void requestDocumentsFolderAccess().then((ok) => {
                if (ok) void load();
              })
            }
          >
            Conceder acesso
          </TaButton>
        )}
      </div>
    );
  }
  if (!blob)
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (isPdf({ mime, filename })) return <PdfView blob={blob} />;
  if (isImage({ mime })) return <ImageView blob={blob} />;
  return <TextView blob={blob} />;
}
