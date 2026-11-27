// "Ativação Chatwoot" no cartão (spec 24): mostra os dados que vão na nota
// privada do ticket — já preenchidos a partir do cartão, com a origem de cada
// um — para revisar e abrir o ticket no Chatwoot. Os campos que vêm de campos
// personalizados podem ser salvos de volta no cartão.
import { useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Mail, MessageSquare, Paperclip, RefreshCw, XCircle } from "lucide-react";
import { TaButton, TaInput, TaModal, TaTextarea, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { ChatwootContext, ChatwootTicket } from "../../db/chatwoot";
import { CHATWOOT_FIELDS, CHATWOOT_FIELD_LABEL, chatwootMissing, chatwootNote, type ChatwootData, type ChatwootField } from "../../lib/chatwootNote";
import {
  activeTickets,
  cancelTicket,
  ChatwootError,
  chatwootReady,
  loadChatwoot,
  openActivationTicket,
  requestChatwootPermission,
  TICKET_STATUS_LABEL,
  ticketStates,
  attachmentsNote,
  CHATWOOT_FILE_MAX,
  sendPrivateFiles,
  sendPublicReply,
  type ChatwootFile,
  type ChatwootSettings,
  type TicketState,
} from "../../lib/chatwoot";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { fetchVersion } from "../../lib/documentFiles";
import { emptyVariables, leftoverVariables, renderReply, REPLY_TEMPLATES, REPLY_VARIABLES, type ReplyTemplate } from "../../lib/chatwootReplies";
import { formatBytes } from "../../lib/files";

const rpc = <T,>(m: string, p: Record<string, unknown>) => (call as unknown as (m: string, p: unknown) => Promise<T>)(m, p);

/** Botão no cartão: só com o Chatwoot configurado e nos funis escolhidos. */
export function useChatwootButton(pipelineId: string, pipelineType: string | undefined): boolean {
  const [s, setS] = useState<ChatwootSettings | null>(null);
  useEffect(() => {
    void loadChatwoot().then(setS);
  }, []);
  if (!chatwootReady(s)) return false;
  return s!.pipelineIds.length ? s!.pipelineIds.includes(pipelineId) : pipelineType === "comercial";
}

/** "20/11/2026" → "21/11/2026". */
const dayAfter = (v: string) => {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]) + 1);
  return d.toLocaleDateString("pt-BR");
};

/** dd/mm/aaaa → aaaa-mm-dd (campo de data do cartão). */
const isoDate = (v: string) => {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const GROUPS: { title: string; fields: ChatwootField[] }[] = [
  { title: "Cliente", fields: ["nome_responsavel", "email_cliente", "usuario", "email_usuario"] },
  { title: "Contratação", fields: ["plano", "vencimento_boleto", "qtd_turmas", "fim_vigencia", "valor"] },
  { title: "Dados para faturamento", fields: ["nome_escola", "razao_social", "cnpj", "cep", "endereco", "email_financeiro"] },
];

export function ChatwootDialog({ cardId, onClose, onChanged }: { cardId: string; onClose: () => void; onChanged?: () => void }) {
  const [ctx, setCtx] = useState<ChatwootContext | null>(null);
  const [data, setData] = useState<ChatwootData | null>(null);
  const [saveBack, setSaveBack] = useState(true);
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ link: string; conversationId: number; paymentCheck?: string | null } | null>(null);
  /** Documentos do cartão (GED) e os escolhidos para ir junto com o ticket. */
  const [docs, setDocs] = useState<CardDoc[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  /** Memorando livre que segue no fim da nota privada (opcional). */
  const [memo, setMemo] = useState("");
  /** Situação real das conversas no Chatwoot (null = consultando ou sem consulta). */
  const [states, setStates] = useState<TicketState[] | null>(null);

  const loadStates = async (ids: number[]) => {
    if (!ids.length) return setStates([]);
    const settings = await loadChatwoot();
    if (!chatwootReady(settings)) return setStates(null);
    setStates(await ticketStates(settings, ids).catch(() => null));
  };

  /** Envia documentos do cartão a uma conversa em andamento (nota privada com os arquivos). */
  const attach = async (conversationId: number, ids: string[], text: string): Promise<string | null> => {
    const settings = await loadChatwoot();
    if (!(await requestChatwootPermission(settings).catch(() => false))) return "Sem a permissão de acesso ao Chatwoot não dá para enviar. Tente de novo e escolha Permitir.";
    try {
      const list = docs.filter((d) => ids.includes(d.id));
      const files = await readDocs(list);
      await sendPrivateFiles(settings, conversationId, attachmentsNote(files.map((f) => f.filename), text), files);
      await rpc("chatwoot.attachRecord", { id: cardId, conversationId, names: files.map((f) => f.filename) });
      onChanged?.();
      return null;
    } catch (e) {
      return errorText(e);
    }
  };

  /** E-mail ao cliente: resposta pública na conversa (com anexos opcionais). */
  const reply = async (conversationId: number, text: string, ids: string[]): Promise<string | null> => {
    const settings = await loadChatwoot();
    if (!(await requestChatwootPermission(settings).catch(() => false))) return "Sem a permissão de acesso ao Chatwoot não dá para enviar. Tente de novo e escolha Permitir.";
    try {
      const files = await readDocs(docs.filter((d) => ids.includes(d.id)));
      await sendPublicReply(settings, conversationId, text, files);
      await rpc("chatwoot.replyRecord", { id: cardId, conversationId, text, to: data?.email_cliente ?? null, names: files.map((f) => f.filename) });
      onChanged?.();
      return null;
    } catch (e) {
      return errorText(e);
    }
  };

  /** Cancela no Chatwoot (nota, devolve ao dono do token, resolve) e registra no cartão. */
  const cancel = async (conversationId: number, note: string): Promise<string | null> => {
    const settings = await loadChatwoot();
    if (!(await requestChatwootPermission(settings).catch(() => false))) return "Sem a permissão de acesso ao Chatwoot não dá para cancelar. Tente de novo e escolha Permitir.";
    try {
      const r = await cancelTicket(settings, conversationId, note);
      await rpc("chatwoot.cancelRecord", { id: cardId, conversationId, note, by: r.user || null });
      onChanged?.();
      return null;
    } catch (e) {
      return errorText(e);
    } finally {
      const c = await rpc<ChatwootContext>("chatwoot.context", { id: cardId }).catch(() => null);
      if (c) setCtx({ ...c, data: ctx?.data ?? c.data });
      await loadStates((c ?? ctx)?.tickets.map((t) => t.conversation_id) ?? []);
    }
  };

  const load = async () => {
    try {
      const c = await rpc<ChatwootContext>("chatwoot.context", { id: cardId });
      setCtx(c);
      setData(c.data);
      void loadStates(c.tickets.map((t) => t.conversation_id));
      void rpc<CardDoc[]>("documents.forEntity", { type: "deal", id: cardId }).then(setDocs).catch(() => setDocs([]));
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = data ? chatwootMissing(data) : [];
  // Só ticket em andamento (não resolvido nem apagado no Chatwoot) pede confirmação para abrir outro.
  const active = ctx ? activeTickets(ctx.tickets, states) : [];
  const blocked = !data || missing.length > 0 || (active.length > 0 && !again);

  /** Campos personalizados alterados aqui → valores para salvar no cartão. */
  const customPatch = (): Record<string, unknown> => {
    if (!ctx || !data) return {};
    const out: Record<string, unknown> = {};
    for (const f of ["qtd_turmas", "plano", "vencimento_boleto", "fim_vigencia", "usuario", "email_usuario", "email_financeiro"] as ChatwootField[]) {
      const def = ctx.fields[f];
      if (!def || data[f] === ctx.data[f]) continue;
      // Usuário igual ao e-mail do contato que já estava no cadastro: é o padrão, não precisa gravar.
      if ((f === "usuario" || f === "email_usuario") && ctx.data.email_cliente.trim() && data[f].trim() === ctx.data.email_cliente.trim()) continue;
      const v = data[f].trim();
      out[def.id] = !v ? null : def.type === "number" ? Number(v.replace(",", ".")) : def.type === "date" ? isoDate(v) : v;
    }
    return out;
  };

  const send = async () => {
    if (!data) return;
    const settings = await loadChatwoot();
    // Permissão do site (1º uso), ainda dentro do clique.
    const allowed = await requestChatwootPermission(settings).catch(() => false);
    if (!allowed) return setError("Sem a permissão de acesso ao Chatwoot não dá para abrir o ticket. Clique de novo e escolha Permitir.");
    setBusy(true);
    setError(null);
    try {
      if (saveBack) {
        const patch = customPatch();
        if (Object.keys(patch).length) await rpc("cards.update", { id: cardId, patch: { customValues: patch } });
      }
      let r: { conversationId: number; link: string; contactCreated: boolean };
      try {
        r = await openActivationTicket(settings, data, fetch, await readDocs(docs.filter((d) => chosen.includes(d.id))), memo);
      } catch (e) {
        // Conversa criada, mas a nota/etiqueta falhou: registra para não duplicar.
        if (e instanceof ChatwootError && e.link) {
          const id = Number(e.link.split("/").pop());
          if (id > 0) await rpc("chatwoot.record", { id: cardId, conversationId: id, link: e.link, data, memo, saveContactEmail: saveBack });
          onChanged?.();
        }
        throw e;
      }
      const rec = await rpc<{ paymentActivityId: string | null }>("chatwoot.record", {
        id: cardId,
        conversationId: r.conversationId,
        link: r.link,
        data,
        contactCreated: r.contactCreated,
        memo,
        saveContactEmail: saveBack,
        attachments: docs.filter((d) => chosen.includes(d.id)).map((d) => d.filename),
      });
      setDone({ link: r.link, conversationId: r.conversationId, paymentCheck: rec?.paymentActivityId ? dayAfter(data.vencimento_boleto) : null });
      onChanged?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TaModal isOpen onClose={onClose} title="Ativação no Chatwoot" width="max-w-3xl">
      <div className="space-y-4 text-theme-sm text-gray-700 dark:text-gray-300" data-chatwoot-dialog>
        {!ctx || !data ? (
          error ? <p className="rounded-lg bg-error-50 px-3 py-2 text-error-700">{error}</p> : <p className="text-gray-500">Carregando…</p>
        ) : done ? (
          <div className="rounded-xl border border-success-200 bg-success-50 p-4 text-success-800 dark:bg-success-500/10" data-chatwoot-done>
            <p className="flex items-center gap-2 font-semibold">
              <Check size={16} /> Ticket aberto no Chatwoot (conversa {done.conversationId})
            </p>
            <p className="mt-1 text-theme-xs">A nota privada com os dados ficou na conversa, atribuída ao financeiro. No cartão ficaram uma nota com o link, a atividade “Acompanhar ativação no Chatwoot” para daqui a 2 dias
              {done.paymentCheck ? ` e “Conferir pagamento do boleto” para ${done.paymentCheck} (um dia após o vencimento)` : ""}.</p>
            <a className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-success-600 px-3 py-1.5 text-theme-xs font-medium text-white hover:bg-success-700" href={done.link} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Abrir no Chatwoot
            </a>
          </div>
        ) : (
          <>
            {ctx.missingFields.length > 0 && (
              <p className="rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800" data-chatwoot-missing-fields>
                Faltam os campos do cartão: {ctx.missingFields.join(", ")}. Um administrador cria em Configurações → Integrações → Chatwoot (Criar os campos). Enquanto isso, preencha aqui.
              </p>
            )}
            {ctx.tickets.length > 0 && (
              <TicketsSection
                tickets={ctx.tickets}
                states={states}
                active={active.length}
                again={again}
                onAgain={setAgain}
                onCancel={cancel}
                docs={docs}
                onAttach={attach}
                data={data}
                onReply={reply}
              />
            )}

            {GROUPS.map((g) => (
              <section key={g.title}>
                <p className="mb-2 text-theme-xs font-semibold uppercase text-gray-500">{g.title}</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {g.fields.map((f) => (
                    <label key={f} className={cn("block", f === "endereco" && "md:col-span-2")}>
                      <span className="mb-1 block text-theme-xs font-medium text-gray-700 dark:text-gray-300">
                        {CHATWOOT_FIELD_LABEL[f]} <span className="font-normal text-gray-400">· {ctx.source[f]}</span>
                      </span>
                      <TaInput
                        value={data[f]}
                        onChange={(e) => setData({ ...data, [f]: e.target.value })}
                        className={cn(missing.includes(f) && "border-warning-400")}
                        placeholder={f === "fim_vigencia" || f === "vencimento_boleto" ? "dd/mm/aaaa" : undefined}
                        aria-label={CHATWOOT_FIELD_LABEL[f]}
                        data-chatwoot-field={f}
                      />
                    </label>
                  ))}
                </div>
              </section>
            ))}

            <section data-chatwoot-attachments>
              <p className="mb-1 text-theme-xs font-semibold uppercase text-gray-500">Anexos (documentos do cartão)</p>
              <DocPicker docs={docs} value={chosen} onChange={setChosen} />
              {chosen.length > 0 && <p className="mt-1 text-theme-xs text-gray-500">Vão numa nota privada logo depois da nota de ativação (só a equipe vê).</p>}
            </section>

            <section>
              <p className="mb-1 text-theme-xs font-semibold uppercase text-gray-500">Nota privada que vai para o Chatwoot</p>
              <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 font-sans text-theme-xs text-gray-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-300" data-chatwoot-preview>
                {chatwootNote(data, memo)}
              </pre>
            </section>

            <section>
              <label className="mb-1 block text-theme-xs font-semibold uppercase text-gray-500" htmlFor="chatwoot-memo">
                Memorando (opcional)
              </label>
              <textarea
                id="chatwoot-memo"
                data-chatwoot-memo
                rows={5}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={"Informação extra que segue no fim da nota privada. Ex.:\nUNIDADE / TURMAS\nCCJ – Brasília 15\nCNSA – Araçatuba 15"}
                className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 font-mono text-theme-xs text-gray-800 focus:border-brand-300 focus:outline-none dark:border-gray-700 dark:text-white/90"
              />
            </section>

            {dayAfter(data.vencimento_boleto) && (
              <p className="text-theme-xs text-gray-500" data-chatwoot-payment-check>
                Ao abrir o ticket, o CRM cria a atividade “Conferir pagamento do boleto” para {dayAfter(data.vencimento_boleto)} (um dia após o vencimento).
              </p>
            )}
            {missing.length > 0 && (
              <p className="rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800" data-chatwoot-missing>
                Preencha: {missing.map((k) => CHATWOOT_FIELD_LABEL[k]).join(", ")}.
              </p>
            )}
            {error && (
              <p className="rounded-lg bg-error-50 px-3 py-2 text-error-700" data-chatwoot-error>
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-theme-xs text-gray-600">
                <input type="checkbox" checked={saveBack} onChange={(e) => setSaveBack(e.target.checked)} />
                Salvar no cartão o que mudei em Plano, Vencimento do boleto, Qtd de turmas, Fim da vigência, Usuário, E-mail do usuário e E-mail financeiro (e o E-mail do cliente no contato principal, se ele não tiver)
              </label>
              <TaButton
                startIcon={busy ? <RefreshCw size={15} className="animate-spin" /> : <MessageSquare size={15} />}
                disabled={busy || blocked}
                onClick={() => void send()}
                data-chatwoot-send
              >
                {busy ? "Abrindo o ticket…" : "Abrir ticket no Chatwoot"}
              </TaButton>
            </div>
          </>
        )}
      </div>
    </TaModal>
  );
}

export { CHATWOOT_FIELDS };

/** E-mail ao cliente: modelo (ou texto livre) já preenchido com os dados do cartão, anexos e confirmação. */
function ReplyForm({
  data,
  docs,
  onSend,
  onCancel,
}: {
  data: ChatwootData;
  docs: CardDoc[];
  onSend: (text: string, ids: string[]) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [tpl, setTpl] = useState<ReplyTemplate["id"]>("ativacao_nota_boleto");
  const template = REPLY_TEMPLATES.find((x) => x.id === tpl)!;
  const [text, setText] = useState(() => renderReply(REPLY_TEMPLATES[0]!.text, data));
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = emptyVariables(template.text, data);
  const leftover = leftoverVariables(text);
  const choose = (id: ReplyTemplate["id"]) => {
    const t = REPLY_TEMPLATES.find((x) => x.id === id)!;
    if (text.trim() && text !== renderReply(template.text, data) && !window.confirm("Trocar o modelo? O texto editado será substituído.")) return;
    setTpl(id);
    setText(renderReply(t.text, data));
  };
  const send = async () => {
    const what = `${ids.length ? ` com ${ids.length} anexo${ids.length > 1 ? "s" : ""}` : ""}`;
    if (!window.confirm(`Enviar este e-mail ao cliente (${data.email_cliente})${what}?\n\nSai pelo Chatwoot, pelo e-mail da inbox, e não dá para desfazer.`)) return;
    setBusy(true);
    setError(null);
    const err = await onSend(text, ids);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <div className="mt-1.5 space-y-2 rounded-md border border-success-200 bg-success-25 p-2 dark:border-success-500/30 dark:bg-success-500/5" data-chatwoot-reply-form>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Modelo:</span>
        <select
          className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-theme-xs dark:border-gray-700 dark:bg-gray-900"
          value={tpl}
          onChange={(e) => choose(e.target.value as ReplyTemplate["id"])}
          aria-label="Modelo do e-mail"
          data-chatwoot-reply-template
        >
          {REPLY_TEMPLATES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <span className="text-gray-500">Para: {data.email_cliente || "(sem e-mail)"}</span>
      </div>
      <TaTextarea rows={12} value={text} onChange={(e) => setText(e.target.value)} aria-label="Mensagem para o cliente" data-chatwoot-reply-text />
      <p className="text-gray-500">Variáveis: {REPLY_VARIABLES.map((v) => `{${v}}`).join(" ")}</p>
      {empty.length > 0 && (
        <p className="text-warning-700" data-chatwoot-reply-empty>
          Sem valor no cartão: {empty.join(", ")}. Confira o texto antes de enviar.
        </p>
      )}
      {leftover.length > 0 && <p className="text-warning-700">Variável não reconhecida no texto: {leftover.map((v) => `{${v}}`).join(", ")}.</p>}
      <div>
        <p className="mb-1 font-medium">
          Anexos {template.withAttachments ? "(boleto e nota fiscal)" : "(opcional)"}
        </p>
        <DocPicker docs={docs} value={ids} onChange={setIds} />
        {template.withAttachments && !ids.length && docs.length > 0 && <p className="mt-1 text-warning-700">Este modelo fala de anexos: marque o boleto e a nota fiscal.</p>}
      </div>
      <p className="text-gray-500">Vai por e-mail para o cliente, pelo endereço da inbox do Chatwoot, e fica na conversa como resposta (não é nota privada).</p>
      {error && <p className="text-error-600" data-chatwoot-reply-error>{error}</p>}
      <div className="flex gap-2">
        <TaButton size="sm" variant="primary" disabled={busy || !text.trim() || !data.email_cliente} onClick={() => void send()} data-chatwoot-reply-send>
          {busy ? "Enviando…" : "Enviar e-mail ao cliente"}
        </TaButton>
        <TaButton size="sm" disabled={busy} onClick={onCancel}>
          Voltar
        </TaButton>
      </div>
    </div>
  );
}

/** Documento do cartão (GED) que pode ir para o Chatwoot. */
interface CardDoc {
  id: string;
  name: string;
  type_name: string | null;
  version_id: string;
  filename: string;
  size_bytes: number;
}

/** Lê os arquivos dos documentos escolhidos (fica na auditoria de cada documento como download). */
async function readDocs(list: CardDoc[]): Promise<ChatwootFile[]> {
  const out: ChatwootFile[] = [];
  for (const d of list) {
    if (d.size_bytes > CHATWOOT_FILE_MAX) throw new Error(`"${d.name}" passa de 40 MB (limite de anexo do Chatwoot).`);
    const f = await fetchVersion(d.version_id, "download");
    out.push({ blob: f.blob, filename: f.filename });
  }
  return out;
}

function DocPicker({ docs, value, onChange }: { docs: CardDoc[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!docs.length) return <p className="text-theme-xs text-gray-400">O cartão não tem documentos. Anexe na aba Documentos do cartão (ex.: contrato assinado, aviso de convocação).</p>;
  return (
    <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-800" data-chatwoot-docs>
      {docs.map((d) => {
        const on = value.includes(d.id);
        const big = d.size_bytes > CHATWOOT_FILE_MAX;
        return (
          <li key={d.id}>
            <label className={cn("flex items-center gap-2 text-theme-xs", big ? "text-gray-400" : "text-gray-700 dark:text-gray-300")}>
              <input type="checkbox" checked={on} disabled={big} onChange={() => onChange(on ? value.filter((x) => x !== d.id) : [...value, d.id])} data-chatwoot-doc={d.name} />
              <span className="truncate">{d.name}</span>
              <span className="ml-auto shrink-0 text-gray-400">
                {[d.type_name, formatBytes(d.size_bytes)].filter(Boolean).join(" · ")}
                {big ? " · grande demais (40 MB)" : ""}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Tickets já abertos pelo cartão: situação real, responsável e "Cancelar ticket" em cada um. */
function TicketsSection({
  tickets,
  states,
  active,
  again,
  onAgain,
  onCancel,
  docs,
  onAttach,
  data,
  onReply,
}: {
  data: ChatwootData;
  onReply: (conversationId: number, text: string, ids: string[]) => Promise<string | null>;
  tickets: ChatwootTicket[];
  states: TicketState[] | null;
  active: number;
  again: boolean;
  onAgain: (v: boolean) => void;
  onCancel: (conversationId: number, note: string) => Promise<string | null>;
  docs: CardDoc[];
  onAttach: (conversationId: number, ids: string[], text: string) => Promise<string | null>;
}) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", active ? "border-warning-200 bg-warning-50 text-warning-800" : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-300")} data-chatwoot-previous>
      <p className="flex items-center gap-1.5 font-medium">
        {active ? <AlertTriangle size={14} /> : <Check size={14} />}
        {active
          ? `Este cartão tem ${active === 1 ? "um ticket em andamento" : `${active} tickets em andamento`} no Chatwoot:`
          : `Tickets anteriores deste cartão (todos encerrados):`}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {tickets.map((t) => (
          <TicketRow
            key={t.id}
            ticket={t}
            state={states?.find((x) => x.id === t.conversation_id) ?? null}
            checking={states === null}
            onCancel={onCancel}
            docs={docs}
            onAttach={onAttach}
            data={data}
            onReply={onReply}
          />
        ))}
      </ul>
      {active > 0 && (
        <label className="mt-2 flex items-center gap-2 text-theme-xs">
          <input type="checkbox" checked={again} onChange={(e) => onAgain(e.target.checked)} data-chatwoot-again />
          Abrir outro ticket mesmo assim
        </label>
      )}
    </div>
  );
}

function TicketRow({
  ticket: t,
  state,
  checking,
  onCancel,
  docs,
  onAttach,
  data,
  onReply,
}: {
  data: ChatwootData;
  onReply: (conversationId: number, text: string, ids: string[]) => Promise<string | null>;
  ticket: ChatwootTicket;
  state: TicketState | null;
  checking: boolean;
  onCancel: (conversationId: number, note: string) => Promise<string | null>;
  docs: CardDoc[];
  onAttach: (conversationId: number, ids: string[], text: string) => Promise<string | null>;
}) {
  const [attaching, setAttaching] = useState(false);
  const [replying, setReplying] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [attachText, setAttachText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = state?.status ?? "unknown";
  const label = state && status !== "unknown" ? TICKET_STATUS_LABEL[status] : t.canceled_at ? "Cancelada pelo cartão" : checking ? "Consultando…" : TICKET_STATUS_LABEL.unknown;
  const done = status === "resolved" || status === "deleted";
  const cancelable = !!state?.cancelable;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    const err = await onCancel(t.conversation_id, note);
    setBusy(false);
    if (err) setError(err);
    else {
      setOpen(false);
      setNote("");
    }
  };
  return (
    <li className="rounded-md bg-white/70 px-2.5 py-1.5 text-theme-xs text-gray-700 dark:bg-gray-900/40 dark:text-gray-300" data-chatwoot-ticket={t.conversation_id}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <a className="font-medium text-brand-600 hover:underline" href={t.link} target="_blank" rel="noreferrer">
          Conversa {t.conversation_id}
        </a>
        <span
          className={cn("rounded px-1.5 py-0.5", done ? "bg-gray-100 text-gray-600 dark:bg-white/10" : status === "unknown" ? "bg-gray-100 text-gray-500 dark:bg-white/10" : "bg-success-50 text-success-700")}
          data-chatwoot-status={status}
        >
          {label}
        </span>
        <span className="text-gray-500">
          {formatDateTime(t.created_at)}
          {t.created_by_name ? ` · aberta por ${t.created_by_name}` : ""}
          {state?.assignee ? ` · com ${state.assignee}` : ""}
        </span>
        {cancelable && !open && !attaching && !replying && (
          <span className="ml-auto flex gap-3">
            <button type="button" className="inline-flex items-center gap-1 font-medium text-success-700 hover:underline" onClick={() => setReplying(true)} data-chatwoot-reply>
              <Mail size={13} /> Responder ao cliente
            </button>
            <button type="button" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline" onClick={() => setAttaching(true)} data-chatwoot-attach>
              <Paperclip size={13} /> Enviar documentos
            </button>
            <button type="button" className="inline-flex items-center gap-1 font-medium text-error-600 hover:underline" onClick={() => setOpen(true)} data-chatwoot-cancel>
              <XCircle size={13} /> Cancelar ticket
            </button>
          </span>
        )}
      </div>
      {t.cancel_note && <p className="mt-0.5 text-gray-500">Observação do cancelamento: {t.cancel_note}</p>}
      {state?.error && <p className="mt-0.5 text-gray-400">Não deu para consultar no Chatwoot agora.</p>}
      {open && (
        <div className="mt-1.5 space-y-1.5" data-chatwoot-cancel-form>
          <TaInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (obrigatória): motivo do cancelamento" aria-label="Observação do cancelamento" autoFocus />
          <p className="text-gray-500">A observação vai como nota privada; a conversa é resolvida e volta para o usuário dono do token do Chatwoot. Nada é apagado e o cliente não recebe e-mail.</p>
          <div className="flex gap-2">
            <TaButton size="sm" variant="primary" disabled={busy || note.trim().length < 3} onClick={() => void confirm()} data-chatwoot-cancel-confirm>
              {busy ? "Cancelando…" : "Confirmar cancelamento"}
            </TaButton>
            <TaButton size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Voltar
            </TaButton>
          </div>
        </div>
      )}
      {attaching && (
        <div className="mt-1.5 space-y-1.5" data-chatwoot-attach-form>
          <DocPicker docs={docs} value={pick} onChange={setPick} />
          <TaInput value={attachText} onChange={(e) => setAttachText(e.target.value)} placeholder="Comentário (opcional), ex.: contrato assinado pela diretora" aria-label="Comentário dos anexos" />
          <div className="flex gap-2">
            <TaButton
              size="sm"
              variant="primary"
              disabled={busy || !pick.length}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const err = await onAttach(t.conversation_id, pick, attachText);
                setBusy(false);
                if (err) return setError(err);
                setSent(`${pick.length} documento${pick.length > 1 ? "s" : ""} enviado${pick.length > 1 ? "s" : ""} como nota privada.`);
                setAttaching(false);
                setPick([]);
                setAttachText("");
              }}
              data-chatwoot-attach-send
            >
              {busy ? "Enviando…" : "Enviar ao Chatwoot"}
            </TaButton>
            <TaButton size="sm" disabled={busy} onClick={() => setAttaching(false)}>
              Voltar
            </TaButton>
          </div>
        </div>
      )}
      {replying && (
        <ReplyForm
          data={data}
          docs={docs}
          onCancel={() => setReplying(false)}
          onSend={async (text, ids) => {
            const err = await onReply(t.conversation_id, text, ids);
            if (!err) {
              setReplying(false);
              setSent(`E-mail enviado ao cliente (${data.email_cliente})${ids.length ? ` com ${ids.length} anexo${ids.length > 1 ? "s" : ""}` : ""}.`);
            }
            return err;
          }}
        />
      )}
      {sent && <p className="mt-1 text-success-700" data-chatwoot-attach-done>{sent}</p>}
      {error && <p className="mt-1 text-error-600" data-chatwoot-cancel-error>{error}</p>}
    </li>
  );
}
