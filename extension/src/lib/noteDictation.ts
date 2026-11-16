// Nota por áudio: grava, a IA transcreve e depois ajusta o texto para ficar
// claro (pontuação, sem vícios de fala e repetições), sem inventar nada.
import { aiGenerate, transcribeAudio, type AiSettings } from "./ai";
import { dataUrlBase64, fileToDataUrl } from "./files";

/** Gravação máxima (o Gemini recebe o áudio dentro da requisição). */
export const NOTE_AUDIO_MAX_SECONDS = 10 * 60;

export function polishPrompt(raw: string): string {
  return [
    "Você recebe a transcrição de um áudio ditado por um vendedor/atendente para registrar uma nota no CRM.",
    "Reescreva como uma nota clara e bem escrita, em português do Brasil:",
    "- corrija pontuação, concordância e palavras mal transcritas óbvias;",
    "- tire vícios de fala (\"é…\", \"tipo\", \"né\", \"então assim\"), hesitações e repetições;",
    "- mantenha TODOS os fatos: nomes, valores, datas, prazos, quantidades, telefones, e-mails, combinados e próximos passos;",
    "- não invente, não acrescente opiniões nem informações que não estão no áudio;",
    "- escreva em primeira pessoa, como no áudio; parágrafos curtos; use lista com \"- \" só para vários itens ou próximos passos;",
    "- sem título, sem markdown (nada de ** ou #), sem comentários sobre a transcrição.",
    "Responda somente com o texto final da nota.",
    "",
    "Transcrição:",
    '"""',
    raw.trim(),
    '"""',
  ].join("\n");
}

/** Limpa a resposta da IA (aspas, cercas de código, negrito). */
export function cleanPolished(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-z]*\n?|\n?```$/gi, "").trim();
  if (/^".*"$/s.test(t) || /^""".*"""$/s.test(t)) t = t.replace(/^"+|"+$/g, "").trim();
  t = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Áudio → transcrição → texto ajustado. Se o ajuste falhar, devolve a transcrição. */
export async function dictateNote(
  ai: AiSettings,
  audio: Blob,
  deps: { transcribe?: typeof transcribeAudio; generate?: typeof aiGenerate } = {},
): Promise<{ text: string; raw: string; polished: boolean }> {
  const transcribe = deps.transcribe ?? transcribeAudio;
  const generate = deps.generate ?? aiGenerate;
  const mime = (audio.type || "audio/webm").split(";")[0]!;
  const raw = (await transcribe(ai, dataUrlBase64(await fileToDataUrl(audio)), mime, "nota.webm")).trim();
  if (!raw) throw new Error("Não deu para entender o áudio (silêncio ou muito baixo). Tente gravar de novo, mais perto do microfone.");
  try {
    const t = cleanPolished(await generate(ai, polishPrompt(raw), [], 2000));
    return t ? { text: t, raw, polished: true } : { text: raw, raw, polished: false };
  } catch {
    return { text: raw, raw, polished: false };
  }
}
