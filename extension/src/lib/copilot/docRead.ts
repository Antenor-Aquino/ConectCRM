// Leitura de documento para o Copiloto criar um cartão (spec 12): tudo
// localmente, sem IA — o texto do arquivo e, quando o conteúdo está em imagem
// (cabeçalho com o nome/endereço do cliente, PDF escaneado, foto), as imagens
// que a IA com visão vai ler. A IA só recebe o que sair daqui.
import { unzipSync } from "fflate";
import { isImage, isPdf } from "../documentFiles";
import { imageToPng, pdfPages } from "../transcribe";

export interface ReadDocument {
  /** Texto do documento (cortado em MAX_TEXT). */
  text: string;
  /** Imagens PNG em base64 para a IA ler (cabeçalho, páginas escaneadas, foto). */
  images: string[];
  /** "Word", "PDF", "PDF escaneado", "Imagem", "Planilha", "Texto". */
  kind: string;
  /** Texto cortado por ser grande demais. */
  truncated: boolean;
}

/** Limite de texto enviado à IA (~10 mil tokens). */
export const MAX_TEXT = 40_000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

/** Texto de um XML do Word: só os textos (w:t), com parágrafos, quebras, tabulações e células de tabela. */
export function wordXmlText(xml: string): string {
  // Caixas de texto vêm duplicadas (versão nova + "Fallback" antiga): fica só a nova.
  const body = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  let out = "";
  for (const m of body.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>|<\/w:tc>|<\/w:tr>|<\/w:p>/g)) {
    const tag = m[0];
    if (m[1] !== undefined) out += decode(m[1]);
    else if (tag === "<w:tab/>") out += "\t";
    else if (tag.startsWith("<w:br")) out += "\n";
    else if (tag === "</w:tc>") out += " | ";
    else out += "\n";
  }
  return out
    .replace(/\n+ \| /g, " | ")
    .replace(/[ \t]*\|[ \t]*\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const dec = new TextDecoder();

/** DOCX → texto (cabeçalho, corpo, rodapé) e as imagens do cabeçalho (e do corpo, se quase não houver texto). */
export function readDocx(bytes: Uint8Array): { text: string; images: { name: string; data: Uint8Array }[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Não foi possível abrir o arquivo do Word (está corrompido ou protegido por senha?).");
  }
  const xml = (name: string) => (files[name] ? dec.decode(files[name]) : "");
  if (!files["word/document.xml"]) throw new Error("Este arquivo não parece ser um documento do Word (.docx).");
  const sorted = (re: RegExp) => Object.keys(files).filter((n) => re.test(n)).sort();
  const headers = sorted(/^word\/header\d*\.xml$/);
  const footers = sorted(/^word\/footer\d*\.xml$/);
  const parts = [
    ...headers.map((h) => wordXmlText(xml(h))),
    wordXmlText(xml("word/document.xml")),
    ...footers.map((f) => wordXmlText(xml(f))),
  ].filter(Boolean);
  const text = parts.join("\n\n");

  // Imagens referenciadas (relacionamentos de cada parte → word/media/...).
  const mediaOf = (part: string) => {
    const rels = xml(part.replace(/^word\//, "word/_rels/") + ".rels");
    return [...rels.matchAll(/Target="(media\/[^"]+)"/g)].map((m) => `word/${m[1]}`);
  };
  const wanted = [...headers.flatMap(mediaOf), ...(text.replace(/\s/g, "").length < 300 ? mediaOf("word/document.xml") : [])];
  const images = [...new Set(wanted)]
    .filter((n) => /\.(png|jpe?g|gif|bmp|webp)$/i.test(n) && files[n] && files[n]!.length <= MAX_IMAGE_BYTES)
    .slice(0, MAX_IMAGES)
    .map((n) => ({ name: n, data: files[n]! }));
  return { text, images };
}

const cut = (text: string) => ({ text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text, truncated: text.length > MAX_TEXT });

const mimeOf = (name: string) =>
  /\.png$/i.test(name) ? "image/png" : /\.gif$/i.test(name) ? "image/gif" : /\.webp$/i.test(name) ? "image/webp" : /\.bmp$/i.test(name) ? "image/bmp" : "image/jpeg";

export const DOC_ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.eml,.html,.htm,.json,.xml,.png,.jpg,.jpeg,.webp";

/** Lê o arquivo; lança erro com a mensagem para o usuário quando não dá. */
export async function readDocument(file: File, canSeeImages: boolean): Promise<ReadDocument> {
  const name = file.name.toLowerCase();
  if (/\.docx$/.test(name)) {
    const { text, images } = readDocx(new Uint8Array(await file.arrayBuffer()));
    const pngs = canSeeImages ? await Promise.all(images.map((i) => imageToPng(new Blob([i.data as Uint8Array<ArrayBuffer>], { type: mimeOf(i.name) })).catch(() => null))) : [];
    return { kind: "Word", images: pngs.filter((p): p is string => !!p), ...cut(text) };
  }
  if (/\.(doc|odt|rtf|pptx?)$/.test(name)) throw new Error("Este formato não é lido pelo Copiloto. Salve como .docx ou PDF e envie de novo.");
  if (isPdf(file)) {
    const pages = await pdfPages(file, 30, "text");
    const text = pages.join("\n\n").trim();
    if (text.replace(/\s/g, "").length >= 200) return { kind: "PDF", images: [], ...cut(text) };
    // Escaneado: as primeiras páginas viram imagem para a IA ler.
    if (!canSeeImages) throw new Error("Este PDF é escaneado (imagem) e a IA configurada não lê imagens. Use Gemini, OpenAI ou Claude.");
    return { kind: "PDF escaneado", images: await pdfPages(file, MAX_IMAGES, "image"), text, truncated: false };
  }
  if (isImage(file)) {
    if (!canSeeImages) throw new Error("A IA configurada não lê imagens. Use Gemini, OpenAI ou Claude.");
    return { kind: "Imagem", images: [await imageToPng(file)], text: "", truncated: false };
  }
  if (/\.(xlsx|xls)$/.test(name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
    const text = wb.SheetNames.slice(0, 5)
      .map((s) => `# ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s]!, { FS: " | " })}`)
      .join("\n\n");
    return { kind: "Planilha", images: [], ...cut(text) };
  }
  if (/^text\//.test(file.type) || /\.(txt|csv|md|eml|html?|json|xml)$/.test(name)) {
    let text = await file.text();
    if (/\.html?$/.test(name)) text = decode(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    return { kind: "Texto", images: [], ...cut(text.trim()) };
  }
  throw new Error("Tipo de arquivo não suportado. Envie PDF, Word (.docx), planilha, imagem ou texto.");
}
