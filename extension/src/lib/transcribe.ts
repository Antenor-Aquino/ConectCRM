// Transcrição opcional ao enviar documento (spec 08): áudio (Gemini/Whisper),
// PDF com texto (copiado direto do arquivo, sem IA), PDF escaneado e imagem
// (a IA lê as páginas). Antes de enviar, avisa o que não dá para transcrever,
// o que é extenso (só uma parte) e o que é complexo (revisar o resultado).
import { AI_LABELS, AI_READS_IMAGES, AI_TRANSCRIBES, aiConfigured, aiGenerate, transcribeAudio, type AiSettings } from "./ai";
import { isImage, isPdf, type PreparedFile } from "./documentFiles";
import { dataUrlBase64, fileToDataUrl, formatBytes, isAudioFile } from "./files";
import { closePdf, loadPdf } from "./pdf";

export type TranscribeKind = "audio" | "pdf-text" | "pdf-scan" | "image";

export interface TranscribeCheck {
  kind: TranscribeKind | null;
  /** ok = pode; warn = pode, com ressalva (extenso/complexo); no = não dá. */
  level: "ok" | "warn" | "no";
  message: string;
  /** PDF: páginas que serão transcritas (de `pages`). */
  pages?: number;
  limit?: number;
}

/** PDF com texto: até 50 páginas; escaneado: até 10 (cada página vira imagem para a IA). */
export const MAX_TEXT_PAGES = 50;
export const MAX_SCAN_PAGES = 10;
/** Áudio: o Gemini recebe o arquivo dentro da requisição (limite ~20 MB em base64). */
const GEMINI_AUDIO_BYTES = 14 * 1024 * 1024;
const LONG_AUDIO_MIN = 20;
/** Resposta da IA quando não há texto na imagem. */
const NO_TEXT = "SEM TEXTO";

const OFFICE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i;
const PLAIN = /\.(txt|csv|md|json|xml|html?)$/i;

function audioMinutes(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration / 60 : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    a.src = url;
  });
}

const needAi = (ai: AiSettings | null): string | null =>
  ai && aiConfigured(ai) ? null : "Para transcrever, configure a IA em Configurações → Inteligência artificial.";

export async function checkTranscription(p: PreparedFile, ai: AiSettings | null): Promise<TranscribeCheck> {
  const f = p.file;
  const prov = ai ? AI_LABELS[ai.provider] : "";
  if (isAudioFile(f)) {
    const missing = needAi(ai);
    if (missing) return { kind: "audio", level: "no", message: missing };
    if (!AI_TRANSCRIBES.includes(ai!.provider))
      return {
        kind: "audio",
        level: "no",
        message: `O ${prov} não transcreve áudio. Troque para Gemini ou OpenAI em Configurações → Inteligência artificial.`,
      };
    if (ai!.provider === "gemini" && f.size > GEMINI_AUDIO_BYTES)
      return { kind: "audio", level: "no", message: `Áudio grande demais para o Gemini (${formatBytes(f.size)}; até 14 MB). Use a OpenAI ou divida o áudio.` };
    const min = await audioMinutes(f);
    if (min && min > LONG_AUDIO_MIN)
      return { kind: "audio", level: "warn", message: `Áudio longo (${Math.round(min)} min): a transcrição pode levar alguns minutos.` };
    const length = !min ? "" : min < 1 ? ` de ${Math.max(1, Math.round(min * 60))} s` : ` de ${Math.round(min)} min`;
    return { kind: "audio", level: "ok", message: `Áudio${length}: transcrição pelo ${prov}.` };
  }
  if (isPdf(f)) {
    if (p.text === undefined) return { kind: "pdf-text", level: "no", message: "Não foi possível ler este PDF (protegido por senha ou danificado)." };
    let pages = 0;
    try {
      const doc = await loadPdf(f);
      pages = doc.numPages;
      closePdf(doc);
    } catch {
      return { kind: "pdf-text", level: "no", message: "Não foi possível ler este PDF (protegido por senha ou danificado)." };
    }
    if (p.text) {
      const limit = Math.min(pages, MAX_TEXT_PAGES);
      return pages > MAX_TEXT_PAGES
        ? { kind: "pdf-text", level: "warn", pages, limit, message: `Documento extenso (${pages} páginas): só as ${limit} primeiras serão transcritas.` }
        : { kind: "pdf-text", level: "ok", pages, limit, message: `PDF com texto (${pages} pág.): o texto é copiado do próprio arquivo, sem custo de IA.` };
    }
    // Sem texto: PDF escaneado, a IA lê as páginas como imagem.
    const missing = needAi(ai);
    if (missing) return { kind: "pdf-scan", level: "no", message: `PDF escaneado (sem texto). ${missing}` };
    if (!AI_READS_IMAGES.includes(ai!.provider))
      return { kind: "pdf-scan", level: "no", message: `PDF escaneado: o ${prov} não lê imagens. Use Gemini, OpenAI ou Claude.` };
    const limit = Math.min(pages, MAX_SCAN_PAGES);
    return {
      kind: "pdf-scan",
      level: "warn",
      pages,
      limit,
      message:
        pages > MAX_SCAN_PAGES
          ? `Documento escaneado e extenso (${pages} páginas): só as ${limit} primeiras serão transcritas. Tabelas e manuscritos podem sair com erros.`
          : `PDF escaneado (${pages} pág.): a IA lê as páginas. Documento complexo — tabelas, carimbos e manuscritos podem sair com erros; revise a nota.`,
    };
  }
  if (isImage(f)) {
    const missing = needAi(ai);
    if (missing) return { kind: "image", level: "no", message: missing };
    if (!AI_READS_IMAGES.includes(ai!.provider)) return { kind: "image", level: "no", message: `O ${prov} não lê imagens. Use Gemini, OpenAI ou Claude.` };
    return { kind: "image", level: "warn", message: "Imagem: a IA lê o texto. Fotos tortas, tabelas e manuscritos podem sair com erros; revise a nota." };
  }
  if (/^video\//.test(f.type)) return { kind: null, level: "no", message: "Vídeo não é transcrito. Envie só o áudio para transcrever." };
  if (OFFICE.test(f.name)) return { kind: null, level: "no", message: "Arquivo do Office não é transcrito aqui. Salve como PDF para transcrever." };
  if (PLAIN.test(f.name) || /^text\//.test(f.type)) return { kind: null, level: "no", message: "Já é um arquivo de texto: não precisa transcrever." };
  return { kind: null, level: "no", message: "Este tipo de arquivo não pode ser transcrito." };
}

const DOC_PROMPT = `Transcreva na íntegra o texto das imagens a seguir (páginas de um documento ou foto), em português, na ordem de leitura, sem resumir, sem traduzir e sem comentar.
- Mantenha títulos, listas e parágrafos. Tabelas: uma linha por registro, colunas separadas por " | ".
- Trechos ilegíveis: [ilegível]. Assinaturas, carimbos e logotipos: [assinatura], [carimbo], [logotipo].
- Responda apenas com a transcrição. Se não houver nenhum texto, responda exatamente: ${NO_TEXT}`;

/** Imagem → PNG em base64 (no máximo 2000 px no maior lado). */
async function imageToPng(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return dataUrlBase64(canvas.toDataURL("image/png"));
}

async function pdfPages(file: Blob, limit: number, mode: "text" | "image"): Promise<string[]> {
  const doc = await loadPdf(file);
  try {
    const out: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, limit); i++) {
      const page = await doc.getPage(i);
      if (mode === "text") {
        // Mantém as quebras de linha do PDF (a busca do GED junta tudo).
        const content = await page.getTextContent();
        out.push(
          content.items
            .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : ""))
            .join("")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim(),
        );
      } else {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 1600 / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        out.push(dataUrlBase64(canvas.toDataURL("image/png")));
      }
    }
    return out;
  } finally {
    closePdf(doc);
  }
}

function aiText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").trim();
}

/** Texto transcrito (lança erro com a mensagem para o usuário). */
export async function transcribeFile(p: PreparedFile, check: TranscribeCheck, ai: AiSettings | null, onProgress?: (text: string) => void): Promise<string> {
  const f = p.file;
  switch (check.kind) {
    case "audio":
      return transcribeAudio(ai!, dataUrlBase64(await fileToDataUrl(f)), f.type, f.name);
    case "pdf-text": {
      const pages = await pdfPages(f, check.limit ?? MAX_TEXT_PAGES, "text");
      const text = pages.map((t, i) => (pages.length > 1 ? `— Página ${i + 1} —\n${t}` : t)).join("\n\n");
      if (!text.trim()) throw new Error("O PDF não tem texto legível.");
      return text;
    }
    case "pdf-scan": {
      const images = await pdfPages(f, check.limit ?? MAX_SCAN_PAGES, "image");
      // Lotes de 3 páginas: respostas menores e sem corte.
      const parts: string[] = [];
      for (let i = 0; i < images.length; i += 3) {
        onProgress?.(`páginas ${i + 1}–${Math.min(i + 3, images.length)} de ${images.length}`);
        const t = aiText(await aiGenerate(ai!, DOC_PROMPT, images.slice(i, i + 3), 8000));
        if (t !== NO_TEXT) parts.push(images.length > 3 ? `— Páginas ${i + 1} a ${Math.min(i + 3, images.length)} —\n${t}` : t);
      }
      if (!parts.length) throw new Error("A IA não encontrou texto no documento.");
      return parts.join("\n\n");
    }
    case "image": {
      const t = aiText(await aiGenerate(ai!, DOC_PROMPT, [await imageToPng(f)], 8000));
      if (t === NO_TEXT) throw new Error("A IA não encontrou texto na imagem.");
      return t;
    }
    default:
      throw new Error(check.message);
  }
}

/** Corpo da nota: título com o nome do documento e o aviso de páginas transcritas. */
export function transcriptionNote(docName: string, check: TranscribeCheck, text: string): string {
  const partial = check.pages && check.limit && check.limit < check.pages ? ` (páginas 1 a ${check.limit} de ${check.pages})` : "";
  return `Transcrição de "${docName}"${partial}:\n\n${text}`;
}
