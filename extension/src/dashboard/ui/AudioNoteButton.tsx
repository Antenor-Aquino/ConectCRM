// Botão "Gravar áudio" das notas: grava pelo microfone, a IA transcreve e
// ajusta o texto, que entra na nota para revisar antes de salvar.
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { AI_LABELS, AI_TRANSCRIBES, aiConfigured, loadAiSettings, type AiSettings } from "../../lib/ai";
import { errorText } from "../../lib/errors";
import { dictateNote, NOTE_AUDIO_MAX_SECONDS } from "../../lib/noteDictation";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function AudioNoteButton({
  onText,
  onError,
}: {
  /** Texto pronto (ajustado pela IA) e o áudio gravado. */
  onText: (text: string, audio: File, info: { polished: boolean; raw: string }) => void;
  onError: (message: string | null) => void;
}) {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void loadAiSettings().then(setAi);
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (rec.current?.state === "recording") rec.current.stop();
    };
  }, []);

  const ready = !!ai && aiConfigured(ai) && AI_TRANSCRIBES.includes(ai.provider);
  const why = !ai
    ? ""
    : !aiConfigured(ai)
      ? "Configure a IA em Configurações → Inteligência artificial para ditar notas."
      : !AI_TRANSCRIBES.includes(ai.provider)
        ? `O ${AI_LABELS[ai.provider]} não transcreve áudio: use Gemini ou OpenAI em Configurações → Inteligência artificial.`
        : "";

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (rec.current?.state === "recording") rec.current.stop();
  };

  const start = async () => {
    onError(null);
    if (!ready) return onError(why);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError("Não foi possível acessar o microfone. Libere o acesso ao microfone nas permissões do Chrome.");
    }
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const mime = (r.mimeType || "audio/webm").split(";")[0]!;
      const blob = new Blob(chunks, { type: mime });
      if (blob.size < 1000) {
        setState("idle");
        return onError("A gravação ficou vazia. Clique no microfone, fale e clique em parar.");
      }
      setState("working");
      try {
        const out = await dictateNote(ai!, blob);
        const stamp = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/[/:]/g, "-");
        const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
        onText(out.text, new File([blob], `Áudio da nota ${stamp}.${ext}`, { type: mime }), { polished: out.polished, raw: out.raw });
      } catch (e) {
        onError(errorText(e));
      } finally {
        setState("idle");
      }
    };
    r.start();
    rec.current = r;
    setSeconds(0);
    setState("recording");
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= NOTE_AUDIO_MAX_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
  };

  if (state === "recording")
    return (
      <button
        type="button"
        onClick={stop}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-error-50 px-2.5 py-0.5 font-medium text-error-700 hover:bg-error-100"
        title="Parar e transcrever"
        data-note-audio-stop
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-error-500" />
        Gravando {mmss(seconds)} <Square size={11} className="fill-current" />
      </button>
    );
  if (state === "working")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-brand-600" data-note-audio-working>
        <Loader2 size={13} className="animate-spin" /> Transcrevendo e ajustando…
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => void start()}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
      title={ready ? `Gravar um áudio: o ${AI_LABELS[ai!.provider]} transcreve e ajusta o texto da nota` : why}
      disabled={!ai}
      data-note-audio
    >
      <Mic size={13} /> Gravar áudio
    </button>
  );
}
