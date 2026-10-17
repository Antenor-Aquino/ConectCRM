// Anexar arquivos ao cartão (como no wa-pipedrive): documentos e mídias
// baixados do WhatsApp; áudios podem ser transcritos pela IA (vira nota).
import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Sparkles, Upload, X } from "lucide-react";
import { TaButton, TaTextarea } from "@tailadmin";
import { call } from "../rpc/client";
import { AI_LABELS, AI_TRANSCRIBES, aiConfigured, loadAiSettings, transcribeAudio, type AiSettings } from "../lib/ai";
import { dataUrlBase64, fileToDataUrl, formatBytes, isAudioFile, MAX_UPLOAD_BYTES } from "../lib/files";
import { errText, Section, StatusText, type Status } from "./ui";

interface Picked {
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
  audio: boolean;
  checked: boolean;
}

export function FilesSection({ targetId, onSent }: { targetId: string | null; onSent: () => void }) {
  const [files, setFiles] = useState<Picked[]>([]);
  const [transcript, setTranscript] = useState("");
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadAiSettings().then(setAi);
  }, []);

  const add = async (list: File[]) => {
    const next: Picked[] = [];
    for (const f of list) {
      if (f.size > MAX_UPLOAD_BYTES) {
        setStatus({ text: `"${f.name}" passa de 25 MB e foi ignorado.`, kind: "err" });
        continue;
      }
      next.push({ name: f.name, mime: f.type || "application/octet-stream", size: f.size, dataUrl: await fileToDataUrl(f), audio: isAudioFile(f), checked: true });
    }
    setFiles((cur) => [...cur, ...next]);
  };

  const chosen = files.filter((f) => f.checked);
  const audios = chosen.filter((f) => f.audio);
  const canTranscribe = !!ai && aiConfigured(ai) && AI_TRANSCRIBES.includes(ai.provider);

  const transcribe = async () => {
    if (!ai) return;
    setBusy(true);
    setStatus({ text: `Transcrevendo ${audios.length} áudio(s) com o ${AI_LABELS[ai.provider]}…`, kind: "info" });
    try {
      const parts: string[] = [];
      for (const a of audios) {
        const t = await transcribeAudio(ai, dataUrlBase64(a.dataUrl), a.mime, a.name);
        parts.push(audios.length > 1 ? `[${a.name}]\n${t}` : t);
      }
      setTranscript(parts.join("\n\n"));
      setStatus({ text: "Transcrição pronta. Revise e anexe (vira nota + anexa o áudio).", kind: "ok" });
    } catch (e) {
      setStatus({ text: errText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!targetId) return;
    setBusy(true);
    setStatus({ text: `Anexando ${chosen.length} arquivo(s)…`, kind: "info" });
    try {
      for (const f of chosen) await call("attachments.add", { entityType: "deal", entityId: targetId, filename: f.name, dataUrl: f.dataUrl });
      const text = transcript.trim();
      if (text) await call("notes.add", { entityType: "deal", entityId: targetId, body: `Transcrição de áudio:\n\n${text}` });
      setFiles((cur) => cur.filter((f) => !f.checked));
      setTranscript("");
      setStatus({ text: `${chosen.length} arquivo(s) anexado(s)${text ? " + nota com a transcrição" : ""}.`, kind: "ok" });
      onSent();
    } catch (e) {
      setStatus({ text: errText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Anexar arquivos" icon={<Paperclip size={16} />}>
      <p className="mb-2 text-theme-xs text-gray-500">Baixe o arquivo no WhatsApp (clique nele → ⤓) e selecione aqui. Áudios podem ser transcritos pela IA.</p>
      <TaButton size="sm" startIcon={<Paperclip size={14} />} onClick={() => input.current?.click()}>
        Escolher arquivos
      </TaButton>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,image/*,audio/*,video/*"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          void add(list);
        }}
      />
      {files.length > 0 && (
        <>
          <ul className="mt-2 space-y-1">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-theme-xs text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={f.checked} onChange={() => setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))} />
                {f.audio ? <Mic size={13} className="text-brand-500" /> : <Paperclip size={13} className="text-gray-400" />}
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-gray-400">{formatBytes(f.size)}</span>
                <button type="button" title="Remover" className="text-gray-400 hover:text-error-600" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          {transcript && <TaTextarea className="mt-2" rows={5} value={transcript} onChange={(e) => setTranscript(e.target.value)} />}
          <div className="mt-2 flex gap-2">
            {audios.length > 0 && canTranscribe && (
              <TaButton size="sm" disabled={busy} startIcon={<Sparkles size={14} />} onClick={() => void transcribe()}>
                Transcrever áudio
              </TaButton>
            )}
            <TaButton size="sm" variant="primary" disabled={busy || !chosen.length || !targetId} startIcon={<Upload size={14} />} onClick={() => void send()}>
              Anexar ao cartão
            </TaButton>
          </div>
          {audios.length > 0 && !canTranscribe && (
            <p className="mt-1 text-theme-xs text-gray-400">Para transcrever, configure Gemini ou OpenAI em CRM → Configurações → Inteligência artificial.</p>
          )}
          {!targetId && <p className="mt-1 text-theme-xs text-gray-400">Escolha o negócio de destino acima.</p>}
        </>
      )}
      <StatusText status={status} />
    </Section>
  );
}
