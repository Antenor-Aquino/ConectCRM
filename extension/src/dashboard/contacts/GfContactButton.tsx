// "Enviar para a Gestão Financeira" na ficha do contato/organização (paridade
// de cadastros): passa a acompanhar o cadastro lá; depois disso, toda
// alteração feita aqui vai sozinha (na hora, no modo direto, ou no próximo pacote).
import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import { TaButton } from "@tailadmin";
import { call } from "../../rpc/client";
import { loadGfSettings } from "../../lib/finance/gfBridge";
import { pushPendingContacts } from "../../lib/finance/sync";
import { formatDateTime } from "../../lib/format";

export function GfContactButton({ crmRef, refreshKey }: { crmRef: string; refreshKey?: unknown }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<{ pending: boolean; linkedAt: string; sentAt: string | null } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => void call("finance.contactStatus", { crmRef }).then(setStatus);
  useEffect(() => {
    void loadGfSettings().then((s) => setEnabled(!!((s.gfId && s.direct) || s.package)));
    load();
  }, [crmRef, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      await call("finance.linkContact", { crmRef });
      const r = await pushPendingContacts();
      if (r.status === "ok") setMsg(r.failed.length ? { ok: false, text: r.failed.map((f) => f.message).join("; ") } : { ok: true, text: "Enviado para a Gestão Financeira." });
      else if (r.status === "package") setMsg({ ok: true, text: "Vai no próximo pacote (Configurações → Integrações → Gestão Financeira → Exportar pacote)." });
      else if (r.status === "offline") setMsg({ ok: false, text: `${r.message} Fica pendente e vai na próxima vez.` });
      load();
    } finally {
      setBusy(false);
    }
  }

  const title = status
    ? status.pending
      ? "Está na Gestão Financeira; a última alteração ainda não foi enviada"
      : `Na Gestão Financeira${status.sentAt ? ` · atualizado em ${formatDateTime(status.sentAt)}` : ""}`
    : "Cadastra (com todos os dados) em Clientes e fornecedores da Gestão Financeira";
  return (
    <span className="inline-flex flex-col" data-gf-contact>
      <TaButton startIcon={<Landmark size={15} />} disabled={busy} onClick={() => void send()} title={title} data-gf-contact-send>
        {status ? (status.pending ? "Enviar alteração à Gestão Financeira" : "Reenviar à Gestão Financeira") : "Enviar para a Gestão Financeira"}
      </TaButton>
      {msg && (
        <span className={`mt-1 text-theme-xs ${msg.ok ? "text-success-700" : "text-error-600"}`} data-gf-contact-msg>
          {msg.text}
        </span>
      )}
    </span>
  );
}
