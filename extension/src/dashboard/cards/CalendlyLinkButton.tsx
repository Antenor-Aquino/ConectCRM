// "Link de agendamento" do cartão (spec 18): link do Calendly da conta do funil,
// já preenchido com o nome e o e-mail do contato e a marca deste cartão — a
// reunião marcada por ele entra sozinha neste cartão. Copiar ou mandar pelo WhatsApp.
import { useEffect, useState } from "react";
import { CalendarPlus, Check, Copy, MessageCircle } from "lucide-react";
import { TaButton, TaModal, TaSelect } from "@tailadmin";
import { call } from "../../rpc/client";
import { accountForPipeline, bookingLink, loadCalendly, type CalendlySettings } from "../../lib/calendly";

export function CalendlyLinkButton({ cardId, pipelineId, personId }: { cardId: string; pipelineId: string; personId: string | null }) {
  const [s, setS] = useState<CalendlySettings | null>(null);
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<{ name: string; email: string | null; phone: string | null } | null>(null);
  const [account, setAccount] = useState("");
  const [typeUri, setTypeUri] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadCalendly().then(setS);
  }, []);
  useEffect(() => {
    if (!open || !personId) return setPerson(null);
    void call("persons.get", { id: personId }).then((p) => setPerson(p ? { name: p.name, email: p.email ?? null, phone: p.phone ?? null } : null));
  }, [open, personId]);

  if (!s?.accounts.length) return null;
  const start = () => {
    const acc = accountForPipeline(s, pipelineId)!;
    setAccount(acc.email);
    setTypeUri(acc.eventTypeUri ?? acc.eventTypes[0]?.uri ?? "");
    setCopied(false);
    setOpen(true);
  };
  const acc = s.accounts.find((a) => a.email === account);
  const type = acc?.eventTypes.find((t) => t.uri === typeUri) ?? acc?.eventTypes[0];
  const link = type ? bookingLink(type.url, { name: person?.name, email: person?.email, dealId: cardId }) : null;
  const firstName = person?.name.split(/\s+/)[0];
  const message = link ? `Olá${firstName ? `, ${firstName}` : ""}! Escolha o melhor horário para conversarmos: ${link}` : "";
  const digits = person?.phone?.replace(/\D/g, "") ?? "";

  return (
    <>
      <TaButton variant="ghost" startIcon={<CalendarPlus size={15} />} data-calendly-link title="Link do Calendly para o contato escolher o horário da reunião" onClick={start}>
        Link de agendamento
      </TaButton>
      {open && (
        <TaModal isOpen onClose={() => setOpen(false)} title="Link de agendamento (Calendly)" width="max-w-xl">
          <div className="space-y-3 text-theme-sm text-gray-700 dark:text-gray-300" data-calendly-link-dialog>
            <div className="grid gap-2 sm:grid-cols-2">
              {s.accounts.length > 1 && (
                <TaSelect
                  value={account}
                  onChange={(e) => {
                    const a = s.accounts.find((x) => x.email === e.target.value)!;
                    setAccount(a.email);
                    setTypeUri(a.eventTypeUri ?? a.eventTypes[0]?.uri ?? "");
                  }}
                  data-calendly-link-account
                >
                  {s.accounts.map((a) => (
                    <option key={a.email} value={a.email}>
                      {a.email}
                    </option>
                  ))}
                </TaSelect>
              )}
              <TaSelect value={type?.uri ?? ""} onChange={(e) => setTypeUri(e.target.value)} data-calendly-link-type className={s.accounts.length > 1 ? "" : "sm:col-span-2"}>
                {!acc?.eventTypes.length && <option value="">Nenhum link ativo nesta conta</option>}
                {acc?.eventTypes.map((t) => (
                  <option key={t.uri} value={t.uri}>
                    {t.name} ({t.duration} min)
                  </option>
                ))}
              </TaSelect>
            </div>
            {link && (
              <>
                <textarea readOnly value={message} rows={4} className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-theme-xs dark:border-gray-700 dark:bg-white/5" data-calendly-link-text />
                <p className="text-theme-xs text-gray-500">
                  {person ? `Já vai com o nome${person.email ? " e o e-mail" : ""} de ${person.name}. ` : "Cartão sem contato: o convidado preenche nome e e-mail. "}A reunião marcada por este link entra neste cartão.
                </p>
              </>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <TaButton
                variant="outline"
                startIcon={copied ? <Check size={15} /> : <Copy size={15} />}
                disabled={!link}
                data-calendly-link-copy
                onClick={async () => {
                  await navigator.clipboard.writeText(message);
                  setCopied(true);
                }}
              >
                {copied ? "Copiado" : "Copiar mensagem"}
              </TaButton>
              <TaButton
                variant="primary"
                startIcon={<MessageCircle size={15} />}
                disabled={!link || !digits}
                title={digits ? "Abre a conversa no WhatsApp Web com a mensagem pronta" : "O contato do cartão não tem telefone"}
                data-calendly-link-whatsapp
                onClick={() => void chrome.tabs.create({ url: `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}` })}
              >
                Enviar pelo WhatsApp
              </TaButton>
            </div>
          </div>
        </TaModal>
      )}
    </>
  );
}
