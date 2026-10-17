// Configurações → Inteligência artificial (mesmos provedores do wa-pipedrive).
// Usada pelo popup do WhatsApp: resumo de recortes de tela e transcrição de
// áudio. As chaves ficam só neste computador.
import { useEffect, useState } from "react";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { TaButton, TaInput, TaPanel, TaSelect, TaTextarea } from "@tailadmin";
import {
  AI_DEFAULT_MODELS,
  AI_LABELS,
  AI_TRANSCRIBES,
  aiGenerate,
  DEFAULT_AI_PROMPT,
  DEFAULT_AI_PROMPT2,
  loadAiSettings,
  saveAiSettings,
  type AiProvider,
  type AiSettings as Settings,
} from "../../lib/ai";
import { Field } from "../ui/form";
import { errorText } from "../../lib/errors";

const KEY_HELP: Record<AiProvider, string> = {
  gemini: "aistudio.google.com/apikey",
  openai: "platform.openai.com/api-keys",
  claude: "console.anthropic.com/settings/keys",
  deepseek: "platform.deepseek.com/api_keys",
};

type Msg = { text: string; kind: "ok" | "err" } | null;

export function AiSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadAiSettings().then(setS);
  }, []);
  if (!s) return null;
  const prov = s.provider;
  const set = (patch: Partial<Settings>) => {
    setS({ ...s, ...patch });
    setMsg(null);
  };

  const save = async () => {
    await saveAiSettings(s);
    setMsg({ text: "Configurações salvas.", kind: "ok" });
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await saveAiSettings(s);
      const answer = await aiGenerate(s, "Responda apenas: OK");
      setMsg({ text: `Conexão com o ${AI_LABELS[prov]} funcionando (resposta: "${answer.slice(0, 40)}").`, kind: "ok" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TaPanel title="Inteligência artificial" subtitle="Usada na janela da extensão (ícone na barra do Chrome) para resumir recortes de tela e transcrever áudios. A chave fica só neste computador.">
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Provedor">
            <TaSelect value={prov} onChange={(e) => set({ provider: e.target.value as AiProvider })}>
              {(Object.keys(AI_LABELS) as AiProvider[]).map((p) => (
                <option key={p} value={p}>
                  {AI_LABELS[p]}
                </option>
              ))}
            </TaSelect>
          </Field>
          <Field label="Modelo" hint={`Em branco usa o padrão: ${AI_DEFAULT_MODELS[prov]}`}>
            <TaInput value={s.models[prov] ?? ""} placeholder={AI_DEFAULT_MODELS[prov]} onChange={(e) => set({ models: { ...s.models, [prov]: e.target.value } })} />
          </Field>
        </div>
        <Field label={`Chave de API do ${AI_LABELS[prov]}`} hint={`Gere em ${KEY_HELP[prov]}`}>
          <div className="flex gap-2">
            <TaInput
              type={showKey ? "text" : "password"}
              autoComplete="off"
              value={s.keys[prov] ?? ""}
              onChange={(e) => set({ keys: { ...s.keys, [prov]: e.target.value.trim() } })}
            />
            <TaButton title={showKey ? "Ocultar" : "Mostrar"} onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </TaButton>
          </div>
        </Field>
        {!AI_TRANSCRIBES.includes(prov) && (
          <p className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-theme-sm text-warning-800">O {AI_LABELS[prov]} não transcreve áudio. Para transcrever, use Gemini ou OpenAI.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <TaButton variant="primary" onClick={() => void save()}>
            Salvar
          </TaButton>
          <TaButton disabled={busy || !s.keys[prov]} startIcon={<Sparkles size={15} />} onClick={() => void test()}>
            {busy ? "Testando…" : "Testar conexão"}
          </TaButton>
        </div>
        {msg && <p className={`mt-3 rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}>{msg.text}</p>}
      </TaPanel>

      <TaPanel title="Instruções da IA para os recortes de tela" subtitle="A instrução 1 faz a análise comercial; a instrução 2 só transcreve. Em branco, usa o texto padrão.">
        <PromptField label="Instrução 1 — análise comercial" value={s.prompt1} fallback={DEFAULT_AI_PROMPT} onChange={(v) => set({ prompt1: v })} />
        <PromptField label="Instrução 2 — transcrição" value={s.prompt2} fallback={DEFAULT_AI_PROMPT2} onChange={(v) => set({ prompt2: v })} />
        <TaButton variant="primary" onClick={() => void save()}>
          Salvar instruções
        </TaButton>
      </TaPanel>
    </>
  );
}

function PromptField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <Field
      label={
        <span className="flex items-center justify-between">
          {label}
          {value && (
            <button type="button" className="text-theme-xs font-normal text-brand-600 hover:underline" onClick={() => onChange("")}>
              Voltar ao padrão
            </button>
          )}
        </span>
      }
    >
      <TaTextarea rows={value ? 10 : 4} value={value || fallback} onChange={(e) => onChange(e.target.value === fallback ? "" : e.target.value)} />
    </Field>
  );
}
