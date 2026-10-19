// Enviar um documento pelo WhatsApp (spec 08): escolhe o contato do cartão
// (ou do cadastro) que tem celular, escreve a legenda e envia pelo WhatsApp Web
// aberto neste Chrome. O envio fica na auditoria do documento.
import { useState } from "react";
import { CheckCircle2, ExternalLink, MessageCircle, Send } from "lucide-react";
import { TaButton, TaModal, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { WhatsAppRecipient } from "../../db/documents";
import { fetchVersion } from "../../lib/documentFiles";
import { errorText } from "../../lib/errors";
import { formatBytes } from "../../lib/files";
import { sendFileViaWhatsAppWeb } from "../../lib/notify/waweb";
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
  const [to, setTo] = useState(recipients[0]?.phone ?? "");
  const [caption, setCaption] = useState(doc.name);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const target = recipients.find((r) => r.phone === to);

  const send = async () => {
    if (!target) return;
    setState("sending");
    setError(null);
    try {
      const file = await fetchVersion(doc.version_id, "inline");
      await sendFileViaWhatsAppWeb(target.phone, { blob: file.blob, filename: file.filename, mime: file.mime }, caption.trim());
      await call("documents.logWhatsApp", { id: doc.id, to: `${target.name} · ${formatPhone(target.phone)}` });
      setState("sent");
    } catch (e) {
      setError(errorText(e));
      setState("idle");
    }
  };

  const waClosed = error?.includes("abra o web.whatsapp.com") || error?.includes("não está conectado");

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
            </p>
            <p className="text-theme-xs text-gray-500">O envio ficou registrado na auditoria do documento no GED.</p>
            <TaButton className="mt-2" onClick={onClose}>
              Fechar
            </TaButton>
          </div>
        ) : (
          <>
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
            <p className="mt-1 text-theme-xs text-gray-500">Sai do WhatsApp conectado no WhatsApp Web deste Chrome, sem abrir a conversa.</p>
            {error && (
              <div className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700" data-whatsapp-error>
                {error}
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
              <TaButton variant="primary" startIcon={<Send size={15} />} disabled={!target || state === "sending"} onClick={() => void send()}>
                {state === "sending" ? "Enviando…" : "Enviar"}
              </TaButton>
            </div>
          </>
        )}
      </div>
    </TaModal>
  );
}
