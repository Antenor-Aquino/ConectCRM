// Recortes de tela (como no wa-pipedrive): recorta qualquer parte da tela,
// resume com IA (prompt 1 ou 2) e anexa ao cartão de destino + nota.
import { useCallback, useEffect, useState } from "react";
import { Check, Scissors, Sparkles, Upload, X } from "lucide-react";
import { TaButton, TaTextarea, cn } from "@tailadmin";
import { call } from "../rpc/client";
import { AI_LABELS, aiConfigured, loadAiSettings, summarizeImages, type AiSettings } from "../lib/ai";
import { CLIP_LAST_KEY, CLIPS_KEY, loadClips, saveClips, type Clip, type ClipResult } from "../lib/clips";
import { createDocumentsFrom, dataUrlToFile } from "../lib/documentFiles";
import { DocumentTypeSelect, errText, Section, StatusText, type Status } from "./ui";

export function ClipsSection({ targetId, onSent }: { targetId: string | null; onSent: () => void }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Transcrição é o padrão (e vem primeiro); análise comercial é a outra opção.
  const [which, setWhich] = useState<1 | 2>(2);
  const [summary, setSummary] = useState("");
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [status, setStatus] = useState<Status>(null);

  const reload = useCallback(async () => {
    const list = await loadClips();
    setClips(list);
    // Recortes novos já entram marcados.
    setSelected((prev) => new Set(list.filter((c) => prev.has(c.id) || !prev.size || Date.now() - c.createdAt < 5 * 60_000).map((c) => c.id)));
  }, []);

  useEffect(() => {
    void reload();
    void loadAiSettings().then(setAi);
    // Resultado do último recorte (o popup fecha ao clicar na página).
    void chrome.storage.local.get(CLIP_LAST_KEY).then((r) => {
      const last = r[CLIP_LAST_KEY] as ClipResult | undefined;
      if (!last) return;
      if (last.ok) setStatus({ text: `Recorte adicionado (${last.count}).`, kind: "ok" });
      else if (last.error) setStatus({ text: last.error, kind: "err" });
      void chrome.storage.local.remove(CLIP_LAST_KEY);
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[CLIPS_KEY]) void reload();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [reload]);

  const chosen = clips.filter((c) => selected.has(c.id));

  const newClip = () => {
    setStatus({ text: "Arraste o retângulo na página. Reabra a extensão para ver o recorte.", kind: "info" });
    void chrome.runtime.sendMessage({ target: "background", kind: "clip-start" }).then(
      (r: ClipResult | undefined) => {
        if (!r) return;
        if (r.ok) setStatus({ text: `Recorte adicionado (${r.count}).`, kind: "ok" });
        else if (r.canceled) setStatus({ text: "Recorte cancelado.", kind: "info" });
        else if (r.error) setStatus({ text: r.error, kind: "err" });
        void chrome.storage.local.remove(CLIP_LAST_KEY);
      },
      () => undefined, // popup fechou ao clicar na página: normal
    );
  };

  const summarize = async () => {
    if (!ai) return;
    setBusy(true);
    setStatus({ text: `${which === 2 ? "Transcrevendo" : "Resumindo"} com o ${AI_LABELS[ai.provider]}…`, kind: "info" });
    try {
      // As notas são texto puro: tira o **negrito** do markdown da IA.
      setSummary((await summarizeImages(ai, chosen.map((c) => c.base64), which)).replace(/\*\*(.+?)\*\*/g, "$1"));
      setStatus({ text: "Pronto. Revise o texto e anexe ao cartão.", kind: "ok" });
    } catch (e) {
      setStatus({ text: errText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!targetId) return setStatus({ text: "Escolha o negócio de destino primeiro.", kind: "err" });
    setBusy(true);
    setStatus({ text: `Anexando ${chosen.length} recorte(s)…`, kind: "info" });
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const docs = await createDocumentsFrom(
        chosen.map((c, i) => ({ file: dataUrlToFile(`data:image/png;base64,${c.base64}`, `recorte-${stamp}-${i + 1}.png`), name: `Recorte ${stamp} ${i + 1}` })),
        typeId,
        { type: "deal", id: targetId },
      );
      const text = summary.trim();
      // A nota aponta para os recortes de onde veio (abre a prévia pela nota).
      if (text) await call("notes.add", { entityType: "deal", entityId: targetId, body: text, documentIds: docs.ids });
      await saveClips(clips.filter((c) => !selected.has(c.id)));
      setSelected(new Set());
      setSummary("");
      setStatus({ text: `${chosen.length} recorte(s) anexado(s) ao cartão${text ? " + nota com o resumo" : ""}.`, kind: "ok" });
      onSent();
    } catch (e) {
      setStatus({ text: errText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Recortes de tela" icon={<Scissors size={16} />}>
      <p className="mb-2 text-theme-xs text-gray-500">Recorte qualquer parte da tela (WhatsApp, e-mail, site). Os recortes ficam aqui até você anexar ao cartão.</p>
      <TaButton size="sm" startIcon={<Scissors size={14} />} onClick={newClip}>
        Novo recorte
      </TaButton>
      {clips.length > 0 && (
        <>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {clips.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelected((s) => (s.has(c.id) ? new Set([...s].filter((x) => x !== c.id)) : new Set([...s, c.id])))}
                className={cn("relative h-16 cursor-pointer overflow-hidden rounded-lg border-2", selected.has(c.id) ? "border-brand-500" : "border-gray-200 opacity-60")}
              >
                <img src={`data:image/png;base64,${c.base64}`} alt="recorte" className="h-full w-full object-cover" />
                {selected.has(c.id) && (
                  <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-white">
                    <Check size={10} />
                  </span>
                )}
                <button
                  type="button"
                  title="Remover"
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-900/70 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    void saveClips(clips.filter((x) => x.id !== c.id));
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
          {ai && aiConfigured(ai) ? (
            <div className="mt-3 flex items-center gap-3 text-theme-xs text-gray-600 dark:text-gray-400">
              <label className="flex items-center gap-1">
                <input type="radio" checked={which === 2} onChange={() => setWhich(2)} /> Transcrição
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={which === 1} onChange={() => setWhich(1)} /> Análise comercial
              </label>
            </div>
          ) : (
            <p className="mt-3 text-theme-xs text-gray-500">Para resumir com IA, configure em CRM → Configurações → Inteligência artificial.</p>
          )}
          {summary && <TaTextarea className="mt-2" rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />}
          <div className="mt-2">
            <DocumentTypeSelect value={typeId} onChange={setTypeId} preferred="Foto/imagem" />
          </div>
          <div className="mt-2 flex gap-2">
            {ai && aiConfigured(ai) && (
              <TaButton size="sm" disabled={busy || !chosen.length} startIcon={<Sparkles size={14} />} onClick={() => void summarize()}>
                Resumir com IA
              </TaButton>
            )}
            <TaButton size="sm" variant="primary" disabled={busy || !chosen.length || !targetId || !typeId} startIcon={<Upload size={14} />} onClick={() => void send()}>
              Anexar ao cartão{summary.trim() ? " + nota" : ""}
            </TaButton>
          </div>
          {!targetId && <p className="mt-1 text-theme-xs text-gray-400">Escolha o negócio de destino acima.</p>}
        </>
      )}
      <StatusText status={status} />
    </Section>
  );
}
