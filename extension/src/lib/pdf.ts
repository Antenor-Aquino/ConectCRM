// PDF no GED (pdf.js, carregado só quando preciso): texto para a busca,
// páginas para a prévia e miniatura para a grade. Usa a versão "legacy" do
// pdf.js, que traz polyfills: a normal exige APIs que o Chrome ainda não tem
// em todas as versões (ex.: Map.prototype.getOrInsertComputed).
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

let lib: Promise<typeof import("pdfjs-dist")> | null = null;
function pdfjs() {
  lib ??= (import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<typeof import("pdfjs-dist")>).then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  return lib;
}

const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

export async function loadPdf(data: Blob | Uint8Array): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data.slice();
  const task = m.getDocument({ data: bytes });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
}

/** Libera o documento (e o worker dele). */
export function closePdf(doc: PDFDocumentProxy): void {
  void tasks.get(doc)?.destroy();
}

/** Texto das primeiras páginas (null se não houver texto: PDF escaneado). */
export async function extractPdfText(data: Blob, maxPages = 50): Promise<string | null> {
  const doc = await loadPdf(data);
  try {
    const parts: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    const text = parts.join("\n").replace(/\s+/g, " ").trim();
    return text || null;
  } finally {
    closePdf(doc);
  }
}

/** Desenha uma página no canvas, na largura pedida (em px CSS). */
export async function renderPdfPage(doc: PDFDocumentProxy, pageNo: number, canvas: HTMLCanvasElement, width: number, zoom = 1): Promise<void> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: (width / base.width) * zoom * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  await page.render({ canvas, viewport }).promise;
}

/** Miniatura da 1ª página (data URL PNG). */
export async function pdfThumbnail(data: Blob, width = 240): Promise<string> {
  const doc = await loadPdf(data);
  try {
    const canvas = document.createElement("canvas");
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    closePdf(doc);
  }
}
