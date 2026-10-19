// Enviar um documento pelo WhatsApp (spec 08): escolhe o número de origem
// (Configurações → WhatsApp), o contato que recebe e a mensagem. Conforme o
// número: WhatsApp Web deste Chrome ou Z-API enviam sozinhos; "manual" prepara
// o envio (arquivo baixado, mensagem e link copiados) para o usuário mandar no
// outro perfil do Chrome ou no celular. O envio fica na auditoria do documento.
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, ExternalLink, MessageCircle, Send } from "lucide-react";
import { TaButton, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { WhatsAppRecipient } from "../../db/documents";
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

export function WhatsAppSendModal({ doc, recipients, onClose }: { doc: WhatsAppDoc; recipients: WhatsAppRecipient[]; onClose: () => void }) {
  const { user } = useSession();
  const [senders, setSenders] = useState<WhatsAppSender[] | null>(null);
  const [fromId, setFromId] = useState("");
  const [to, setTo] = useState(recipients[0]?.phone ?? "");
  const [caption, setCaption] = useState(doc.name);
  const [state, setState] = useState<"idle" | "sending" | "manual" | "sent">("idle");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = recipients.find((r) => r.phone === to);

  useEffect(() => {
    void loadSenders(user.id).then(({ senders: list, lastId }) => {
      const all = list.length ? list : [IMPLICIT_WEB_SENDER];
      setSenders(all);
      setFromId(all.find((s) => s.id === lastId)?.id ?? all[0]!.id);
    });
  }, [user.id]);
  const from = senders?.find((s) => s.id === fromId) ?? null;

  const log = (extra = "") =>
    call("documents.logWhatsApp", {
      id: doc.id,
      to: `${target!.name} · ${formatPhone(target!.phone)}${from?.phone ? ` · de ${from.name}` : ""}${extra}`,
    });

  const send = async () => {
    if (!target || !from) return;
    setError(null);
    await rememberSender(user.id, from.id);
    if (from.via === "manual") {
      setState("manual");
      await downloadVersion(doc.version_id).catch((e) => setError(errorText(e)));
      return;
    }
    setState("sending");
    try {
      const file = await fetchVersion(doc.version_id, "inline");
      if (from.via === "zapi") {
        if (!from.zapi) throw new Error("Z-API: complete a configuração do número em Configurações → WhatsApp.");
        if (!(await askZapiPermission())) throw new Error("Sem a permissão de acesso à Z-API.");
        const dataUrl = await blobToDataUrl(new Blob([file.blob], { type: file.mime || "application/octet-stream" }));
        await zapiSendFile(from.zapi, target.phone, { dataUrl, filename: file.filename, mime: file.mime }, caption.trim());
      } else {
        await sendFileViaWhatsAppWeb(target.phone, { blob: file.blob, filename: file.filename, mime: file.mime }, caption.trim(), 20_000, from.phone || null);
      }
      await log();
      setState("sent");
    } catch (e) {
      setError(errorText(e));
      setState("idle");
    }
  };

  const copy = async (what: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(what);
  };

  const waClosed = error?.includes("abra o web.whatsapp.com") || error?.includes("não está conectado ou");
  // Falha dentro do WhatsApp Web (ele mudou por dentro): plano B manual.
  const internalError = error?.includes("não foi possível enviar");
  const chatLink = target ? `https://wa.me/${waDigits(target.phone)}` : "";

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
              Enviado para <b>{target?.name}</b> · {formatPhone(target?.phone ?? "")}
              {from?.phone ? ` (de ${from.name})` : ""}
            </p>
            <p className="text-theme-xs text-gray-500">O envio ficou registrado na auditoria do documento no GED.</p>
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
                  Abra a conversa com {target.name}:{" "}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                    onClick={() => void copy("link", chatLink)}
                  >
                    <Copy size={13} /> {copied === "link" ? "Link copiado" : "Copiar o link da conversa"}
                  </button>
                  <span className="block text-theme-xs text-gray-500">{chatLink} — cole na barra de endereço do outro perfil.</span>
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
                    await log(" (envio manual)");
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
            <div className="mb-4 space-y-1.5" role="radiogroup">
              {recipients.map((r) => (
                <label
                  key={r.phone}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2",
                    to === r.phone ? "border-brand-300 bg-brand-25 dark:bg-brand-500/10" : "border-gray-200 hover:bg-gray-50 dark:border-gray-700",
                  )}
                >
                  <input type="radio" name="wa-to" checked={to === r.phone} onChange={() => setTo(r.phone)} />
                  <MessageCircle size={16} className="text-success-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-theme-sm text-gray-800 dark:text-white/90">{r.name}</span>
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
              <TaButton variant="primary" startIcon={<Send size={15} />} disabled={!target || !from || state === "sending"} onClick={() => void send()}>
                {state === "sending" ? "Enviando…" : from?.via === "manual" ? "Preparar envio" : "Enviar"}
              </TaButton>
            </div>
          </>
        )}
      </div>
    </TaModal>
  );
}
