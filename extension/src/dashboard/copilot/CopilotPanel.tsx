// Painel do Copiloto de IA (botão no topo ou "Perguntar ao Copiloto" no
// cartão). A conversa fica guardada enquanto a aba do CRM estiver aberta;
// "Nova conversa" recomeça do zero. As ações sugeridas só são aplicadas
// quando o usuário clica.
import { useEffect, useRef, useState } from "react";
import { Check, Download, ExternalLink, Mic, NotebookPen, Send, Sparkles, Square, SquarePen, X, ListPlus } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { AI_LABELS, AI_TRANSCRIBES, aiConfigured, loadAiSettings, transcribeAudio, type AiSettings } from "../../lib/ai";
import { askCopilot, cardToHistory, type CopilotMessage } from "../../lib/copilot/agent";
import { rpcExecutor } from "../../lib/copilot/executor";
import type { CopilotAction, CopilotCard } from "../../lib/copilot/tools";
import { dataUrlBase64, fileToDataUrl } from "../../lib/files";
import { downloadWorkbook } from "../../lib/xlsxExport";
import { ROLE_LABEL } from "../../db/users";
import { useSession } from "../session";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";

export interface CopilotRequest {
  question: string;
  cardId?: string | null;
}

/** Abre o painel de qualquer tela (ex.: detalhe do cartão). */
export const COPILOT_EVENT = "conectcrm:copilot";
export function openCopilot(req: CopilotRequest): void {
  window.dispatchEvent(new CustomEvent<CopilotRequest>(COPILOT_EVENT, { detail: req }));
}

interface Entry {
  id: string;
  role: "user" | "assistant";
  text?: string;
  card?: CopilotCard;
}

const STARTERS = [
  "O que devo priorizar hoje?",
  "Quais negócios estão parados?",
  "Como estão as vendas deste mês?",
  "Quais tarefas estão atrasadas?",
  "Qual a previsão ponderada do funil?",
];

/** "AAAA-MM-DDTHH:MM" local → ISO. */
function localToIso(s: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s ?? "");
  if (!m) return null;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 9), +(m[5] ?? 0)).toISOString();
}

export function CopilotPanel({ open, onClose, request, onOpenCard }: { open: boolean; onClose: () => void; request: CopilotRequest | null; onOpenCard: (cardId: string) => void }) {
  const { user } = useSession();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) void loadAiSettings().then(setAi);
  }, [open]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [entries, loading]);

  const ask = async (question: string, focusCard = cardId) => {
    if (!question.trim() || loading) return;
    const settings = await loadAiSettings();
    setAi(settings);
    if (!aiConfigured(settings)) return;
    setInput("");
    setError(null);
    const next = [...entries, { id: crypto.randomUUID(), role: "user" as const, text: question.trim() }];
    setEntries(next);
    setLoading(true);
    const history: CopilotMessage[] = next.map((e) => (e.role === "user" ? { role: "user", content: e.text! } : { role: "assistant", content: cardToHistory(e.card!) }));
    try {
      const card = await askCopilot(settings, history, { userName: user.name, userRole: ROLE_LABEL[user.role], cardId: focusCard }, rpcExecutor);
      setEntries((cur) => [...cur, { id: crypto.randomUUID(), role: "assistant", card }]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  // Pedido vindo de outra tela (ex.: "Perguntar ao Copiloto" no cartão).
  useEffect(() => {
    if (!request) return;
    setCardId(request.cardId ?? null);
    void ask(request.question, request.cardId ?? null);
  }, [request]);

  const reset = () => {
    setEntries([]);
    setError(null);
    setInput("");
    setCardId(null);
  };

  const startRecording = async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Não foi possível acessar o microfone. Libere o acesso nas permissões do Chrome.");
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const mime = (rec.mimeType || "audio/webm").split(";")[0]!;
      setTranscribing(true);
      try {
        const text = await transcribeAudio(ai!, dataUrlBase64(await fileToDataUrl(new Blob(chunks, { type: mime }))), mime, "pergunta.webm");
        await ask(text);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setTranscribing(false);
      }
    };
    rec.start();
    recorder.current = rec;
    setRecording(true);
  };

  if (!open) return null;
  const configured = !!ai && aiConfigured(ai);
  const canTalk = configured && AI_TRANSCRIBES.includes(ai!.provider);
  const busy = loading || transcribing;

  return (
    <div className="fixed inset-0 z-[10000] flex justify-end">
      <div className="fixed inset-0 bg-gray-900/30" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-[600px] flex-col bg-white shadow-theme-xl dark:bg-gray-900">
        <header className="flex items-center gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15">
            <Sparkles size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Copiloto</h2>
            <p className="truncate text-theme-xs text-gray-500">
              Consulta seus negócios, tarefas e relatórios reais{configured ? ` · ${AI_LABELS[ai!.provider]}` : ""}
            </p>
          </div>
          <TaButton size="sm" disabled={!entries.length || busy} startIcon={<SquarePen size={14} />} onClick={reset}>
            Nova conversa
          </TaButton>
          <button type="button" title="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {ai && !configured && (
            <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-theme-sm text-warning-800">
              Para usar o Copiloto, informe a chave de um provedor de IA em <b>Configurações → Inteligência artificial</b>.
            </div>
          )}
          {configured && entries.length === 0 && !loading && (
            <div>
              <p className="mb-3 text-theme-sm text-gray-600 dark:text-gray-400">
                Pergunte em linguagem natural. O Copiloto consulta o CRM (com as suas permissões) e responde com os números de verdade.
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="rounded-full border border-gray-200 px-3 py-1.5 text-theme-xs text-gray-700 hover:border-brand-300 hover:bg-brand-50 dark:border-gray-700 dark:text-gray-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {entries.map((e) =>
            e.role === "user" ? (
              <div key={e.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand-500 px-4 py-2.5 text-theme-sm text-white">
                {e.text}
              </div>
            ) : (
              <CardView key={e.id} card={e.card!} disabled={busy} onAsk={(q) => void ask(q)} onOpenCard={onOpenCard} />
            ),
          )}
          {loading && <p className="text-theme-sm italic text-gray-500">Consultando seus dados…</p>}
          {transcribing && <p className="text-theme-sm italic text-gray-500">Transcrevendo o áudio…</p>}
          {error && <p className="rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
          <div ref={bottom} />
        </div>

        <form
          className="flex items-center gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!configured || busy || recording}
            placeholder={cardId ? "Pergunte sobre este negócio ou qualquer outra coisa…" : "Pergunte ao Copiloto…"}
            className="h-11 flex-1 rounded-full border border-gray-300 bg-white px-4 text-theme-sm text-gray-800 focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
          {canTalk &&
            (recording ? (
              <button
                type="button"
                title="Parar gravação"
                onClick={() => {
                  recorder.current?.stop();
                  setRecording(false);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-error-500 text-white"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                type="button"
                title="Perguntar por áudio"
                disabled={busy}
                onClick={() => void startRecording()}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700"
              >
                <Mic size={16} />
              </button>
            ))}
          <button
            type="submit"
            title="Enviar"
            disabled={!configured || busy || recording || !input.trim()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </form>
      </aside>
    </div>
  );
}

const TONE = { alerta: "text-error-600", positivo: "text-success-700", neutro: "text-gray-900 dark:text-white" } as const;

function Insight({ texto, tom }: CopilotCard["insights"][number]) {
  return (
    <p className="text-theme-sm leading-relaxed text-gray-700 dark:text-gray-300">
      {texto.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
        const m = /^\*\*([^*]+)\*\*$/.exec(part);
        return m ? (
          <strong key={i} className={TONE[tom]}>
            {m[1]}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </p>
  );
}

function CardView({ card, disabled, onAsk, onOpenCard }: { card: CopilotCard; disabled: boolean; onAsk: (q: string) => void; onOpenCard: (id: string) => void }) {
  const t = card.tabela;
  const exportXlsx = () => {
    if (!t) return;
    const slug = card.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    void downloadWorkbook(`${slug || "copiloto"}.xlsx`, [{ name: card.titulo, rows: [t.colunas, ...t.linhas.map((l) => l.celulas)] }]);
  };
  return (
    <div className="max-w-[95%] space-y-3 rounded-2xl rounded-bl-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div>
        <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{card.titulo}</h3>
        {card.subtitulo && <p className="text-theme-xs text-gray-500">{card.subtitulo}</p>}
      </div>
      {card.insights.map((i, k) => (
        <Insight key={k} {...i} />
      ))}
      {t && (
        <div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full text-theme-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  {t.colunas.map((c, i) => (
                    <th key={i} className={cn("px-3 py-2 font-semibold", i && "text-right")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.linhas.map((l, i) => (
                  <tr key={i} className={cn("border-b border-gray-100 last:border-0 dark:border-gray-800", l.destaque === "total" && "bg-gray-50 font-semibold dark:bg-white/5")}>
                    {l.celulas.map((c, j) => (
                      <td key={j} className={cn("px-3 py-2 text-gray-700 dark:text-gray-300", j && "text-right tabular-nums", l.destaque === "alerta" && j === l.celulas.length - 1 && "font-semibold text-error-600")}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={exportXlsx} className="mt-1.5 flex items-center gap-1 text-theme-xs text-brand-600 hover:underline">
            <Download size={12} /> Exportar Excel
          </button>
        </div>
      )}
      {card.acoes.length > 0 && (
        <div className="space-y-1.5">
          {card.acoes.map((a, i) => (
            <ActionButton key={i} action={a} onOpenCard={onOpenCard} />
          ))}
        </div>
      )}
      {card.sugestoes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {card.sugestoes.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onAsk(s)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-theme-xs text-gray-700 hover:border-brand-300 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({ action, onOpenCard }: { action: CopilotAction; onOpenCard: (id: string) => void }) {
  const { user } = useSession();
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  const icon = action.tipo === "criar_tarefa" ? <ListPlus size={14} /> : action.tipo === "adicionar_nota" ? <NotebookPen size={14} /> : <ExternalLink size={14} />;

  const apply = async () => {
    if (action.tipo === "abrir_cartao") return onOpenCard(action.cartaoId);
    setState("busy");
    try {
      if (action.tipo === "criar_tarefa") {
        const dueAt = localToIso(action.quando);
        await call("activities.create", { title: action.titulo!, dealId: action.cartaoId, ownerId: user.id, ...(dueAt ? { dueAt } : {}) });
      } else {
        await call("notes.add", { entityType: "deal", entityId: action.cartaoId, body: action.texto! });
      }
      setState("done");
    } catch (e) {
      setState(errorText(e));
    }
  };

  const done = state === "done";
  const failed = state !== "idle" && state !== "busy" && !done;
  return (
    <div>
      <button
        type="button"
        disabled={state === "busy" || done}
        onClick={() => void apply()}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-theme-xs font-medium",
          done ? "border-success-200 bg-success-50 text-success-700" : "border-brand-200 bg-white text-brand-700 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-gray-900",
        )}
      >
        {done ? <Check size={14} /> : icon}
        <span className="flex-1">{done ? (action.tipo === "criar_tarefa" ? `Tarefa criada: ${action.titulo}` : "Nota adicionada ao cartão") : action.rotulo}</span>
        {action.tipo === "criar_tarefa" && action.quando && !done && <span className="text-gray-500">{formatDateTime(new Date(action.quando).toISOString())}</span>}
      </button>
      {failed && <p className="mt-1 text-theme-xs text-error-600">{state}</p>}
    </div>
  );
}
