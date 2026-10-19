// Enviar um documento pelo WhatsApp (spec 08): escolhe o número de origem
// (Configurações → WhatsApp), o contato que recebe e a mensagem. Conforme o
// número: WhatsApp Web deste Chrome ou Z-API enviam sozinhos; "manual" prepara
// o envio (arquivo baixado, mensagem e link copiados) para o usuário mandar no
// outro perfil do Chrome ou no celular. O envio fica na auditoria do documento.
// Com mais de um contato, nada vem marcado: o usuário escolhe um, vários ou todos.
// Revisão (padrão, Configurações → WhatsApp): o envio fica pendente, o CRM deixa
// o arquivo pronto na conversa do WhatsApp Web e só conclui quando o usuário
// envia no botão verde. Alternativa: envio direto com segundos para cancelar.
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Download, ExternalLink, Loader2, MessageCircle, RotateCcw, Send, SkipForward } from "lucide-react";
import { TaButton, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { DocLinkType, WhatsAppRecipient } from "../../db/documents";
import type { WhatsAppPending } from "../../db/whatsappLog";
import { downloadVersion, fetchVersion } from "../../lib/documentFiles";
import { openWhatsApp } from "../../lib/contactLinks";
import { errorText } from "../../lib/errors";
import { formatBytes } from "../../lib/files";
import { blobToDataUrl, focusTab, sendFileViaWhatsAppWeb, stagedSendDone, stageFileInWhatsAppWeb, waDigits, type StagedSend } from "../../lib/notify/waweb";
import {
  DEFAULT_SEND_PREFS,
  IMPLICIT_WEB_SENDER,
  loadSendPrefs,
  loadSenders,
  rememberSender,
  SENDER_VIA_LABEL,
  zapiSendFile,
  askZapiPermission,
  type SendPrefs,
  type WhatsAppSender,
} from "../../lib/whatsappSenders";
import { useSession } from "../session";
import { formatPhone } from "../ui/PhoneInput";
import { FileTypeIcon } from "./docUi";

export interface WhatsAppDoc {
  id: string;
  name: string;
  filename: string;
  mime: string;
  version_id: string;
  size?: number;
}

type DocFile = Awaited<ReturnType<typeof fetchVersion>>;
/** Quanto tempo esperar o usuário enviar na revisão (depois fica pendente). */
const REVIEW_WAIT_MS = 15 * 60_000;

export function WhatsAppSendModal({
  doc,
  recipients,
  context,
  onClose,
  onSent,
  pending,
}: {
  doc: WhatsAppDoc;
  recipients: WhatsAppRecipient[];
  /** Retomar um envio pendente (aba Documentos → Enviar agora). */
  pending?: WhatsAppPending;
  /** Tela de onde se envia (o envio vira atividade concluída nela). */
  context: { type: DocLinkType; id: string };
  onClose: () => void;
  onSent?: () => void;
}) {
  const { user } = useSession();
  // Envio pendente: só o contato dele (fixo, para comparar por referência).
  const [pendingRecipient] = useState<WhatsAppRecipient | null>(() =>
    pending
      ? {
          id: pending.recipient_id,
          kind: pending.recipient_kind,
          name: pending.recipient_name,
          phone: pending.recipient_phone,
          role: "Envio pendente",
        }
      : null,
  );
  if (pendingRecipient) recipients = [pendingRecipient];
  const [senders, setSenders] = useState<WhatsAppSender[] | null>(null);
  const [prefs, setPrefs] = useState<SendPrefs>(DEFAULT_SEND_PREFS);
  const [fromId, setFromId] = useState("");
  const [to, setTo] = useState<string[]>(recipients.length === 1 ? [recipients[0]!.phone] : []);
  const [caption, setCaption] = useState(pending ? (pending.caption ?? "") : doc.name);
  const [state, setState] = useState<"idle" | "countdown" | "sending" | "review" | "manual" | "sent">("idle");
  const [left, setLeft] = useState(0);
  /** Revisão: contato da vez (índice em `queue`), e se a prévia está pronta no WhatsApp Web. */
  const [queue, setQueue] = useState<WhatsAppRecipient[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [staged, setStaged] = useState(false);
  const [stageFailed, setStageFailed] = useState(false);
  /** Envio pendente de cada contato (telefone → id do envio). */
  const sendIds = useRef<Record<string, string>>(pending ? { [pending.recipient_phone]: pending.id } : {});
  const fileRef = useRef<DocFile | null>(null);
  const run = useRef(0);
  const crmTab = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Para quem já foi (num envio para vários, os que falharam continuam marcados). */
  const [sentTo, setSentTo] = useState<WhatsAppRecipient[]>([]);
  const targets = recipients.filter((r) => to.includes(r.phone));
  const target = targets[0];
  const many = recipients.length > 1;
  const allChecked = many && targets.length === recipients.length;
  const toggle = (phone: string) => setTo((cur) => (cur.includes(phone) ? cur.filter((p) => p !== phone) : [...cur, phone]));

  useEffect(() => {
    void loadSenders(user.id).then(({ senders: list, lastId }) => {
      const all = list.length ? list : [IMPLICIT_WEB_SENDER];
      setSenders(all);
      const preferred = pending?.sender_id ?? lastId;
      setFromId(all.find((s) => s.id === preferred)?.id ?? all[0]!.id);
    });
    void loadSendPrefs(user.id).then(setPrefs);
    void chrome.tabs?.getCurrent?.().then((t) => (crmTab.current = t?.id));
    // Fechou a janela: para de esperar o envio (o que faltou fica pendente).
    return () => void run.current++;
  }, [user.id, pending?.sender_id]);
  const from = senders?.find((s) => s.id === fromId) ?? null;
  const fromLabel = from?.phone ? `${from.name} · ${formatPhone(from.phone)}` : null;
  /** Revisão no WhatsApp Web (só com o WhatsApp Web deste Chrome); a Z-API sempre usa a contagem. */
  const reviewMode = from?.via === "web" && prefs.mode === "review";

  const recipientOf = (r: WhatsAppRecipient) => ({ kind: r.kind, id: r.id, name: r.name, phone: r.phone });

  /** Cria o envio pendente (com a atividade pendente) de quem ainda não tem. */
  const prepare = async (list: WhatsAppRecipient[], manual = false) => {
    for (const r of list) {
      if (sendIds.current[r.phone]) continue;
      const { sendId } = await call("documents.whatsappPrepare", {
        documentId: doc.id,
        context,
        recipient: recipientOf(r),
        phoneLabel: formatPhone(r.phone),
        from: fromLabel,
        senderId: from?.id === IMPLICIT_WEB_SENDER.id ? null : (from?.id ?? null),
        caption,
        manual,
      });
      sendIds.current[r.phone] = sendId;
    }
    onSent?.();
  };

  /** Registra que saiu: conclui o pendente (se houver) ou cria a atividade concluída. */
  const log = async (r: WhatsAppRecipient, manual = false) => {
    const sendId = sendIds.current[r.phone];
    if (sendId)
      await call("documents.whatsappConfirm", {
        sendId,
        phoneLabel: formatPhone(r.phone),
        from: fromLabel,
        senderId: from?.id === IMPLICIT_WEB_SENDER.id ? null : (from?.id ?? null),
        caption,
        manual,
      });
    else
      await call("documents.logWhatsApp", {
        documentId: doc.id,
        context,
        recipient: recipientOf(r),
        phoneLabel: formatPhone(r.phone),
        from: fromLabel,
        caption,
        manual,
      });
    setSentTo((cur) => (cur.includes(r) ? cur : [...cur, r]));
  };

  const file = async () => (fileRef.current ??= await fetchVersion(doc.version_id, "inline"));

  const send = async () => {
    if (!targets.length || !from) return;
    setError(null);
    setStageFailed(false);
    await rememberSender(user.id, from.id);
    if (from.via === "manual") {
      try {
        await prepare(targets, true);
      } catch (e) {
        return setError(errorText(e));
      }
      setState("manual");
      await downloadVersion(doc.version_id).catch((e) => setError(errorText(e)));
      return;
    }
    if (reviewMode) return startReview(targets);
    return countdown(targets);
  };

  // ---------- Envio direto com segundos para cancelar ----------

  const countdown = (list: WhatsAppRecipient[]) => {
    const my = ++run.current;
    setError(null);
    setQueue(list);
    setState("countdown");
    let n = prefs.delaySec;
    setLeft(n);
    const tick = () => {
      if (my !== run.current) return;
      if (n <= 0) return void sendDirect(list);
      setLeft(n);
      n--;
      setTimeout(tick, 1000);
    };
    tick();
  };
  const cancelCountdown = () => {
    run.current++;
    setState("idle");
  };

  const sendDirect = async (targets: WhatsAppRecipient[]) => {
    if (!from) return;
    setState("sending");
    const ok: WhatsAppRecipient[] = [];
    const failed: { r: WhatsAppRecipient; why: string }[] = [];
    try {
      const file = await fileRefOrFetch();
      let dataUrl = "";
      if (from.via === "zapi") {
        if (!from.zapi) throw new Error("Z-API: complete a configuração do número em Configurações → WhatsApp.");
        if (!(await askZapiPermission())) throw new Error("Sem a permissão de acesso à Z-API.");
        dataUrl = await blobToDataUrl(new Blob([file.blob], { type: file.mime || "application/octet-stream" }));
      }
      for (const [i, r] of targets.entries()) {
        // Pequena pausa entre um contato e outro (envio em sequência rápida chama atenção do WhatsApp).
        if (i > 0) await new Promise((res) => setTimeout(res, 1500));
        try {
          if (from.via === "zapi") await zapiSendFile(from.zapi!, r.phone, { dataUrl, filename: file.filename, mime: file.mime }, caption.trim());
          else await sendFileViaWhatsAppWeb(r.phone, { blob: file.blob, filename: file.filename, mime: file.mime }, caption.trim(), 20_000, from.phone || null);
          await log(r);
          ok.push(r);
        } catch (e) {
          failed.push({ r, why: errorText(e) });
          // Problema do WhatsApp/Z-API (não do contato): não adianta tentar os outros.
          if (!/não tem WhatsApp|mesmo do WhatsApp Web/.test(errorText(e))) break;
        }
      }
    } catch (e) {
      setError(errorText(e));
      setState("idle");
      return;
    }
    if (ok.length) onSent?.();
    if (ok.length === targets.length) return setState("sent");
    const missing = targets.filter((t) => !ok.includes(t));
    setTo(missing.map((t) => t.phone));
    setError(
      (ok.length ? `Enviado para ${ok.map((r) => r.name).join(", ")}. ` : "") +
        (failed.length === 1 && targets.length === 1
          ? failed[0]!.why
          : `${failed.map((f) => `${f.r.name}: ${f.why}`).join(" ")}${missing.length > failed.length ? ` Não enviado para ${missing.filter((p) => !failed.some((f) => f.r === p)).map((p) => p.name).join(", ")}.` : ""}`),
    );
    setState("idle");
  };

  const fileRefOrFetch = file;

  // ---------- Revisão no WhatsApp Web ----------

  const startReview = async (list: WhatsAppRecipient[]) => {
    try {
      await prepare(list);
    } catch (e) {
      return setError(errorText(e));
    }
    setQueue(list);
    setState("review");
    await reviewStep(list, 0);
  };

  /** Deixa o arquivo pronto na conversa de list[i] e espera o usuário enviar. */
  const reviewStep = async (list: WhatsAppRecipient[], i: number) => {
    const my = ++run.current;
    const r = list[i];
    if (!r) {
      await focusTab(crmTab.current);
      setState(sentToCount.current ? "sent" : "idle");
      return;
    }
    setReviewIdx(i);
    setStaged(false);
    setStageFailed(false);
    setError(null);
    let st: StagedSend;
    try {
      const f = await file();
      st = await stageFileInWhatsAppWeb(r.phone, { blob: f.blob, filename: f.filename, mime: f.mime }, caption.trim(), from?.phone || null);
    } catch (e) {
      if (my !== run.current) return;
      const msg = errorText(e);
      setError(msg);
      setStageFailed(msg.includes("deixar o arquivo pronto"));
      await focusTab(crmTab.current);
      return;
    }
    if (my !== run.current) return;
    setStaged(true);
    const until = Date.now() + REVIEW_WAIT_MS;
    while (my === run.current && Date.now() < until) {
      await new Promise((res) => setTimeout(res, 2000));
      if (my !== run.current) return;
      if (await stagedSendDone(st)) {
        try {
          await log(r);
          sentToCount.current++;
          onSent?.();
        } catch (e) {
          setError(errorText(e));
          return;
        }
        return reviewStep(list, i + 1);
      }
    }
    if (my === run.current) setError("O envio não foi feito no WhatsApp Web. Ele continua pendente no cartão (aba Documentos → Enviar agora).");
  };
  const sentToCount = useRef(0);

  const copy = async (what: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(what);
  };

  const waClosed = error?.includes("abra o web.whatsapp.com") || error?.includes("não está conectado ou");
  // Falha dentro do WhatsApp Web (ele mudou por dentro): plano B manual.
  const internalError = error?.includes("não foi possível enviar");
  const chatLink = (r: WhatsAppRecipient) => `https://wa.me/${waDigits(r.phone)}`;
  const names = (list: WhatsAppRecipient[]) => list.map((r) => r.name).join(", ");

  return (
    <TaModal isOpen onClose={onClose} title="Enviar pelo WhatsApp" width="max-w-lg">
      <div data-whatsapp-send>
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-white/5">
          <FileTypeIcon mime={doc.mime} size={18} />
          <div className="min-w-0">
            <p className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{doc.name}</p>
            <p className="truncate text-theme-xs text-gray-500">
              {doc.filename}
              {doc.size ? ` · ${formatBytes(doc.size)}` : ""}
            </p>
          </div>
        </div>

        {state === "sent" ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center" data-whatsapp-sent>
            <CheckCircle2 size={36} className="text-success-500" />
            <p className="text-theme-sm text-gray-800 dark:text-white/90">
              Enviado para{" "}
              {sentTo.length === 1 ? (
                <>
                  <b>{sentTo[0]!.name}</b> · {formatPhone(sentTo[0]!.phone)}
                </>
              ) : (
                <b>{names(sentTo)}</b>
              )}
              {from?.phone ? ` (de ${from.name})` : ""}
            </p>
            <p className="text-theme-xs text-gray-500">
              {sentTo.length > 1 ? "Cada envio registrado" : "Registrado"} como atividade concluída (tipo WhatsApp) e na auditoria do documento.
            </p>
            {queue.length > sentTo.length && (
              <p className="text-theme-xs text-warning-700">
                Ficaram pendentes no cartão: {names(queue.filter((r) => !sentTo.includes(r)))} (aba Documentos → Enviar agora).
              </p>
            )}
            <TaButton className="mt-2" onClick={onClose}>
              Fechar
            </TaButton>
          </div>
        ) : state === "countdown" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center" data-whatsapp-countdown>
            <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-brand-200 text-title-sm font-semibold text-brand-600">{left}</div>
            <p className="text-theme-sm text-gray-800 dark:text-white/90">
              Enviando para <b>{names(queue)}</b> em {left} s…
            </p>
            <TaButton variant="primary" onClick={cancelCountdown}>
              Cancelar envio
            </TaButton>
          </div>
        ) : state === "review" && queue[reviewIdx] ? (
          <div data-whatsapp-review>
            <p className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-500">
              Revisar no WhatsApp Web{queue.length > 1 ? ` · ${reviewIdx + 1} de ${queue.length}` : ""}
            </p>
            {staged ? (
              <>
                <p className="mb-3 text-theme-sm text-gray-700 dark:text-gray-300">
                  A conversa com <b>{queue[reviewIdx]!.name}</b> · {formatPhone(queue[reviewIdx]!.phone)} está aberta no WhatsApp Web, com o arquivo e a mensagem
                  prontos. Confira e clique no <b>botão verde de enviar</b>.
                </p>
                <p className="mb-4 flex items-center gap-2 text-theme-sm text-gray-500" data-whatsapp-waiting>
                  <Loader2 size={15} className="animate-spin" /> Aguardando o envio… (fica pendente no cartão até sair)
                </p>
              </>
            ) : error ? null : (
              <p className="mb-4 flex items-center gap-2 text-theme-sm text-gray-500">
                <Loader2 size={15} className="animate-spin" /> Preparando a conversa com {queue[reviewIdx]!.name} no WhatsApp Web…
              </p>
            )}
            {error && (
              <div className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700" data-whatsapp-error>
                {error}
                {stageFailed && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium underline"
                      onClick={() => countdown(queue.slice(reviewIdx))}
                      data-whatsapp-direct
                    >
                      Enviar direto ({prefs.delaySec} s para cancelar)
                    </button>
                  </div>
                )}
                {waClosed && (
                  <button
                    type="button"
                    className="ml-2 inline-flex items-center gap-1 font-medium underline"
                    onClick={() => void chrome.tabs.create({ url: "https://web.whatsapp.com/", pinned: true })}
                  >
                    Abrir WhatsApp Web <ExternalLink size={12} />
                  </button>
                )}
              </div>
            )}
            {sentTo.length > 0 && <p className="mb-3 text-theme-xs text-success-700">Já enviado para {names(sentTo)}.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <TaButton startIcon={<RotateCcw size={14} />} onClick={() => void reviewStep(queue, reviewIdx)}>
                Preparar de novo
              </TaButton>
              {queue.length > reviewIdx + 1 && (
                <TaButton startIcon={<SkipForward size={14} />} onClick={() => void reviewStep(queue, reviewIdx + 1)}>
                  Pular este contato
                </TaButton>
              )}
              <TaButton onClick={onClose}>Fechar</TaButton>
            </div>
            <p className="mt-3 text-theme-xs text-gray-500">O que não for enviado fica pendente no cartão (aba Documentos → Enviar agora).</p>
          </div>
        ) : state === "manual" && target && from ? (
          <div data-whatsapp-manual>
            <p className="mb-3 text-theme-sm text-gray-700 dark:text-gray-300">
              Envio manual pelo <b>{from.name}</b> · {formatPhone(from.phone)}. No perfil do Chrome ou no celular onde esse WhatsApp está aberto:
            </p>
            <ol className="mb-4 space-y-2.5 text-theme-sm text-gray-700 dark:text-gray-300">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] text-white">1</span>
                <span className="flex-1">
                  {targets.length > 1 ? "Para cada contato, abra a conversa:" : `Abra a conversa com ${target.name}:`}
                  {targets.map((r) => (
                    <span key={r.phone} className="block">
                      {targets.length > 1 && <span className="text-gray-800 dark:text-white/90">{r.name} </span>}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                        onClick={() => void copy(`link-${r.phone}`, chatLink(r))}
                      >
                        <Copy size={13} /> {copied === `link-${r.phone}` ? "Link copiado" : "Copiar o link da conversa"}
                      </button>
                      <span className="block text-theme-xs text-gray-500">{chatLink(r)}</span>
                    </span>
                  ))}
                  <span className="block text-theme-xs text-gray-500">Cole o link na barra de endereço do outro perfil.</span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] text-white">2</span>
                <span className="flex-1">
                  Arraste para a conversa o arquivo que acabou de ser baixado ({doc.filename}).{" "}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                    onClick={() => void downloadVersion(doc.version_id)}
                  >
                    <Download size={13} /> Baixar de novo
                  </button>
                </span>
              </li>
              {caption.trim() && (
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] text-white">3</span>
                  <span className="flex-1">
                    Cole a mensagem:{" "}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                      onClick={() => void copy("msg", caption.trim())}
                    >
                      <Copy size={13} /> {copied === "msg" ? "Mensagem copiada" : "Copiar a mensagem"}
                    </button>
                  </span>
                </li>
              )}
            </ol>
            {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <TaButton onClick={() => setState("idle")}>Voltar</TaButton>
              <TaButton
                variant="primary"
                startIcon={<CheckCircle2 size={15} />}
                onClick={() =>
                  void (async () => {
                    try {
                      for (const r of targets) await log(r, true);
                    } catch (e) {
                      return setError(errorText(e));
                    }
                    onSent?.();
                    setState("sent");
                  })()
                }
              >
                Já enviei
              </TaButton>
            </div>
          </div>
        ) : (
          <>
            {senders && senders.length > 1 && (
              <>
                <p className="mb-1.5 text-theme-sm font-medium text-gray-700 dark:text-gray-300">Enviar de</p>
                <TaSelect className="mb-1" value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label="Enviar de">
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.phone ? ` · ${formatPhone(s.phone)}` : ""} — {SENDER_VIA_LABEL[s.via]}
                    </option>
                  ))}
                </TaSelect>
                <p className="mb-4 text-theme-xs text-gray-500">
                  {from?.via === "manual"
                    ? "Manual: o CRM baixa o arquivo e copia a mensagem e o link; você envia pelo WhatsApp desse número."
                    : from?.via === "zapi"
                      ? "Sai pela Z-API, sozinho."
                      : "Sai do WhatsApp Web aberto neste Chrome, sem abrir a conversa (o CRM confere se é este número)."}
                </p>
              </>
            )}
            <p className="mb-1.5 text-theme-sm font-medium text-gray-700 dark:text-gray-300">Para</p>
            {many && <p className="mb-2 text-theme-xs text-gray-500">Este cartão tem {recipients.length} contatos com WhatsApp. Escolha para quem enviar.</p>}
            <div className="mb-4 space-y-1.5" data-wa-recipients>
              {many && (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2",
                    allChecked ? "border-brand-300 bg-brand-25 dark:bg-brand-500/10" : "border-gray-200 hover:bg-gray-50 dark:border-gray-700",
                  )}
                >
                  <input type="checkbox" checked={allChecked} onChange={() => setTo(allChecked ? [] : recipients.map((r) => r.phone))} aria-label="Todos os contatos" />
                  <MessageCircle size={16} className="text-success-600" />
                  <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">Todos os contatos ({recipients.length})</span>
                </label>
              )}
              {recipients.map((r) => (
                <label
                  key={r.phone}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2",
                    many && "ml-6",
                    to.includes(r.phone) ? "border-brand-300 bg-brand-25 dark:bg-brand-500/10" : "border-gray-200 hover:bg-gray-50 dark:border-gray-700",
                  )}
                >
                  <input
                    type={many ? "checkbox" : "radio"}
                    name="wa-to"
                    checked={to.includes(r.phone)}
                    onChange={() => (many ? toggle(r.phone) : setTo([r.phone]))}
                    aria-label={r.name}
                  />
                  <MessageCircle size={16} className="text-success-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-theme-sm text-gray-800 dark:text-white/90">
                      {r.name}
                      {sentTo.some((x) => x.phone === r.phone) && <span className="ml-1.5 text-theme-xs text-success-700">· enviado</span>}
                    </span>
                    <span className="block text-theme-xs text-gray-500">
                      {formatPhone(r.phone)} · {r.role}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mb-1.5 text-theme-sm font-medium text-gray-700 dark:text-gray-300">Mensagem junto com o arquivo</p>
            <textarea
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              aria-label="Mensagem"
              className="w-full rounded-lg border border-gray-300 bg-transparent px-3.5 py-2.5 text-theme-sm text-gray-800 shadow-theme-xs outline-none focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            />
            {senders && senders.length <= 1 && (
              <p className="mt-1 text-theme-xs text-gray-500">
                {from?.via === "manual"
                  ? `Manual pelo ${from.name}: o CRM prepara e você envia.`
                  : from?.via === "zapi"
                    ? `Sai pela Z-API (${from.name}).`
                    : "Sai do WhatsApp conectado no WhatsApp Web deste Chrome, sem abrir a conversa."}
              </p>
            )}
            {error && (
              <div className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700" data-whatsapp-error>
                {error}
                {internalError && target && (
                  <div className="mt-2">
                    <p className="text-theme-xs">O WhatsApp Web mudou e o envio automático falhou. Envie manualmente:</p>
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 font-medium underline"
                      onClick={() =>
                        void (async () => {
                          await downloadVersion(doc.version_id);
                          await openWhatsApp(target.phone);
                        })()
                      }
                    >
                      Baixar o arquivo e abrir a conversa com {target.name.split(" ")[0]} <ExternalLink size={12} />
                    </button>
                    <p className="mt-1 text-theme-xs">Depois é só arrastar o arquivo baixado para a conversa.</p>
                  </div>
                )}
                {waClosed && (
                  <button
                    type="button"
                    className="ml-2 inline-flex items-center gap-1 font-medium underline"
                    onClick={() => void chrome.tabs.create({ url: "https://web.whatsapp.com/", pinned: true })}
                  >
                    Abrir WhatsApp Web <ExternalLink size={12} />
                  </button>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <TaButton onClick={onClose}>Cancelar</TaButton>
              <TaButton variant="primary" startIcon={<Send size={15} />} disabled={!targets.length || !from || state === "sending"} onClick={() => void send()}>
                {state === "sending"
                  ? "Enviando…"
                  : from?.via === "manual"
                    ? "Preparar envio"
                    : reviewMode
                      ? targets.length > 1
                        ? `Revisar e enviar (${targets.length})`
                        : "Revisar no WhatsApp Web"
                      : targets.length > 1
                      ? `Enviar para ${targets.length} contatos`
                      : many && !targets.length
                        ? "Escolha o contato"
                        : "Enviar"}
              </TaButton>
            </div>
          </>
        )}
      </div>
    </TaModal>
  );
}
