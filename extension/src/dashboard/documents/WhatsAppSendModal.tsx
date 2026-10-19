// Enviar um documento pelo WhatsApp (spec 08): escolhe o número de origem
// (Configurações → WhatsApp), o contato que recebe e a mensagem. Conforme o
// número: WhatsApp Web deste Chrome ou Z-API enviam sozinhos; "manual" prepara
// o envio (arquivo baixado, mensagem e link copiados) para o usuário mandar no
// outro perfil do Chrome ou no celular. O envio fica na auditoria do documento.
// Com mais de um contato, nada vem marcado: o usuário escolhe um, vários ou todos.
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, ExternalLink, MessageCircle, Send } from "lucide-react";
import { TaButton, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { DocLinkType, WhatsAppRecipient } from "../../db/documents";
import { downloadVersion, fetchVersion } from "../../lib/documentFiles";
import { openWhatsApp } from "../../lib/contactLinks";
import { errorText } from "../../lib/errors";
import { formatBytes } from "../../lib/files";
import { blobToDataUrl, sendFileViaWhatsAppWeb, waDigits } from "../../lib/notify/waweb";
import {
  IMPLICIT_WEB_SENDER,
  loadSenders,
  rememberSender,
  SENDER_VIA_LABEL,
  zapiSendFile,
  askZapiPermission,
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

export function WhatsAppSendModal({
  doc,
  recipients,
  context,
  onClose,
  onSent,
}: {
  doc: WhatsAppDoc;
  recipients: WhatsAppRecipient[];
  /** Tela de onde se envia (o envio vira atividade concluída nela). */
  context: { type: DocLinkType; id: string };
  onClose: () => void;
  onSent?: () => void;
}) {
  const { user } = useSession();
  const [senders, setSenders] = useState<WhatsAppSender[] | null>(null);
  const [fromId, setFromId] = useState("");
  const [to, setTo] = useState<string[]>(recipients.length === 1 ? [recipients[0]!.phone] : []);
  const [caption, setCaption] = useState(doc.name);
  const [state, setState] = useState<"idle" | "sending" | "manual" | "sent">("idle");
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
      setFromId(all.find((s) => s.id === lastId)?.id ?? all[0]!.id);
    });
  }, [user.id]);
  const from = senders?.find((s) => s.id === fromId) ?? null;

  const log = async (r: WhatsAppRecipient, manual = false) => {
    await call("documents.logWhatsApp", {
      documentId: doc.id,
      context,
      recipient: { kind: r.kind, id: r.id, name: r.name, phone: r.phone },
      phoneLabel: formatPhone(r.phone),
      from: from?.phone ? `${from.name} · ${formatPhone(from.phone)}` : null,
      caption,
      manual,
    });
  };

  const send = async () => {
    if (!targets.length || !from) return;
    setError(null);
    await rememberSender(user.id, from.id);
    if (from.via === "manual") {
      setState("manual");
      await downloadVersion(doc.version_id).catch((e) => setError(errorText(e)));
      return;
    }
    setState("sending");
    const ok: WhatsAppRecipient[] = [];
    const failed: { r: WhatsAppRecipient; why: string }[] = [];
    try {
      const file = await fetchVersion(doc.version_id, "inline");
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
    setSentTo((cur) => [...cur, ...ok]);
    if (ok.length === targets.length) return setState("sent");
    const pending = targets.filter((t) => !ok.includes(t));
    setTo(pending.map((t) => t.phone));
    setError(
      (ok.length ? `Enviado para ${ok.map((r) => r.name).join(", ")}. ` : "") +
        (failed.length === 1 && targets.length === 1
          ? failed[0]!.why
          : `${failed.map((f) => `${f.r.name}: ${f.why}`).join(" ")}${pending.length > failed.length ? ` Não enviado para ${pending.filter((p) => !failed.some((f) => f.r === p)).map((p) => p.name).join(", ")}.` : ""}`),
    );
    setState("idle");
  };

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
            <TaButton className="mt-2" onClick={onClose}>
              Fechar
            </TaButton>
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
                    for (const r of targets) await log(r, true);
                    setSentTo(targets);
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
                      {sentTo.includes(r) && <span className="ml-1.5 text-theme-xs text-success-700">· enviado</span>}
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
