// Configurações → WhatsApp: números de origem do usuário (ex.: "Comercial",
// "Suporte"). Na hora de enviar um documento, escolhe-se de qual número sai.
// Ficam neste computador, para o usuário atual (como os provedores de e-mail).
import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, MessageCircle, Pencil, Plus, Trash2, Wifi } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel, TaSelect } from "@tailadmin";
import { errorText } from "../../lib/errors";
import { connectedWhatsAppNumber } from "../../lib/notify/waweb";
import {
  askZapiPermission,
  loadSenders,
  sameNumber,
  saveSenders,
  SENDER_VIA_LABEL,
  ZAPI_HELP,
  zapiStatus,
  type SenderVia,
  type WhatsAppSender,
} from "../../lib/whatsappSenders";
import { useSession } from "../session";
import { Field } from "../ui/form";
import { formatPhone } from "../ui/PhoneInput";

type Draft = { id?: string; name: string; phone: string; via: SenderVia; instanceId: string; token: string; clientToken: string };
const EMPTY: Draft = { name: "", phone: "", via: "web", instanceId: "", token: "", clientToken: "" };
const HINT: Record<SenderVia, string> = {
  web: "Envia sozinho pelo WhatsApp Web aberto neste Chrome. Só um número por perfil do Chrome; o CRM confere se é o número conectado.",
  manual:
    "Para o número que fica aberto em outro perfil do Chrome ou no celular: o CRM baixa o arquivo, copia a mensagem e o link da conversa, e você envia por lá.",
  zapi: "Envia sozinho pela Z-API (serviço pago que conecta o número pelo QR Code), com qualquer perfil do Chrome aberto.",
};

export function WhatsAppSettings() {
  const { user } = useSession();
  const [list, setList] = useState<WhatsAppSender[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void loadSenders(user.id).then((r) => setList(r.senders));
  }, [user.id]);
  if (!list) return null;

  const persist = async (next: WhatsAppSender[]) => {
    setList(next);
    await saveSenders(user.id, next);
  };

  const save = async () => {
    setError(null);
    const name = draft.name.trim();
    const digits = draft.phone.replace(/\D/g, "");
    if (!name) return setError("Dê um nome ao número (ex.: Comercial).");
    if (digits.length < 10) return setError("Informe o número com DDD.");
    if (draft.via === "zapi") {
      if (!draft.instanceId.trim() || !draft.token.trim()) return setError("Informe a instância e o token da Z-API.");
      if (!(await askZapiPermission())) return setError("Sem a permissão de acesso à Z-API o envio não funciona.");
    }
    if (draft.via === "web" && list.some((s) => s.via === "web" && s.id !== draft.id))
      return setError("Já existe um número pelo WhatsApp Web deste Chrome. Cada perfil do Chrome conecta um só; use Manual ou Z-API para o outro.");
    const sender: WhatsAppSender = {
      id: draft.id ?? crypto.randomUUID(),
      name,
      phone: draft.phone.trim(),
      via: draft.via,
      ...(draft.via === "zapi" ? { zapi: { instanceId: draft.instanceId.trim(), token: draft.token.trim(), clientToken: draft.clientToken.trim() } } : {}),
    };
    await persist(draft.id ? list.map((s) => (s.id === draft.id ? sender : s)) : [...list, sender]);
    setDraft(EMPTY);
  };

  const test = async (s: WhatsAppSender) => {
    setBusy(s.id);
    try {
      if (s.via === "web") {
        const me = await connectedWhatsAppNumber();
        const ok = !!me && sameNumber(me, s.phone);
        setChecks((c) => ({
          ...c,
          [s.id]: ok
            ? { ok, text: "Conectado no WhatsApp Web deste Chrome." }
            : { ok, text: `O WhatsApp Web deste Chrome está conectado em ${me ? formatPhone(`+${me}`) : "nenhum número"}, não neste.` },
        }));
      } else if (s.via === "zapi" && s.zapi) {
        if (!(await askZapiPermission())) throw new Error("Sem a permissão de acesso à Z-API.");
        const st = await zapiStatus(s.zapi);
        setChecks((c) => ({
          ...c,
          [s.id]: st.connected
            ? { ok: true, text: "Instância conectada na Z-API." }
            : { ok: false, text: `Instância desconectada${st.error ? `: ${st.error}` : ""}. Leia o QR Code no painel da Z-API.` },
        }));
      } else {
        setChecks((c) => ({ ...c, [s.id]: { ok: true, text: "Envio manual: não há conexão para testar." } }));
      }
    } catch (e) {
      setChecks((c) => ({ ...c, [s.id]: { ok: false, text: errorText(e) } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <TaPanel
      title="WhatsApp"
      subtitle="Números de onde você envia mensagens e documentos. Com mais de um, o envio pergunta de qual número sai. Ficam neste computador, para o seu usuário."
    >
      {list.length === 0 ? (
        <p className="mb-4 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-theme-sm text-gray-500 dark:border-gray-700">
          Nenhum número cadastrado: os envios saem do WhatsApp Web aberto neste Chrome.
        </p>
      ) : (
        <ul className="mb-5 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800" data-wa-senders>
          {list.map((s) => (
            <li key={s.id} className="px-4 py-2.5" data-wa-sender={s.name}>
              <div className="flex items-center gap-3">
                <MessageCircle size={16} className="shrink-0 text-success-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    {s.name} <span className="font-normal text-gray-500">· {formatPhone(s.phone)}</span>
                  </p>
                  <TaBadge color={s.via === "manual" ? "slate" : "green"} label={SENDER_VIA_LABEL[s.via]} />
                </div>
                <TaButton size="sm" startIcon={<Wifi size={14} />} disabled={busy === s.id} onClick={() => void test(s)}>
                  Testar
                </TaButton>
                <button
                  type="button"
                  title="Editar"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600"
                  onClick={() =>
                    setDraft({
                      id: s.id,
                      name: s.name,
                      phone: s.phone,
                      via: s.via,
                      instanceId: s.zapi?.instanceId ?? "",
                      token: s.zapi?.token ?? "",
                      clientToken: s.zapi?.clientToken ?? "",
                    })
                  }
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  title="Remover"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-error-50 hover:text-error-600"
                  onClick={() => confirm(`Remover o número "${s.name}"?`) && void persist(list.filter((x) => x.id !== s.id))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {checks[s.id] && (
                <p className={`mt-1.5 flex items-center gap-1 text-theme-xs ${checks[s.id]!.ok ? "text-success-700" : "text-error-600"}`} data-wa-check>
                  {checks[s.id]!.ok && <CheckCircle2 size={13} />} {checks[s.id]!.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700" data-wa-form>
        <p className="mb-3 text-theme-sm font-medium text-gray-800 dark:text-white/90">{draft.id ? "Editar número" : "Adicionar número"}</p>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="Nome" required>
            <TaInput
              value={draft.name}
              placeholder="Ex.: Comercial"
              aria-label="Nome do número"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Número" required hint="Com DDD.">
            <TaInput
              value={draft.phone}
              placeholder="(81) 98729-8285"
              aria-label="Número de origem"
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          </Field>
          <Field label="Forma de envio">
            <TaSelect value={draft.via} aria-label="Forma de envio" onChange={(e) => setDraft({ ...draft, via: e.target.value as SenderVia })}>
              {(Object.keys(SENDER_VIA_LABEL) as SenderVia[]).map((v) => (
                <option key={v} value={v}>
                  {SENDER_VIA_LABEL[v]}
                </option>
              ))}
            </TaSelect>
          </Field>
        </div>
        <p className="-mt-2 mb-3 text-theme-xs text-gray-500">{HINT[draft.via]}</p>
        {draft.via === "zapi" && (
          <>
            <div className="grid gap-x-4 sm:grid-cols-3">
              <Field label="ID da instância" required>
                <TaInput value={draft.instanceId} aria-label="ID da instância" onChange={(e) => setDraft({ ...draft, instanceId: e.target.value })} />
              </Field>
              <Field label="Token da instância" required>
                <TaInput
                  type="password"
                  autoComplete="off"
                  value={draft.token}
                  aria-label="Token da instância"
                  onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                />
              </Field>
              <Field label="Client-Token" hint="Z-API → Segurança (se ativado).">
                <TaInput
                  type="password"
                  autoComplete="off"
                  value={draft.clientToken}
                  aria-label="Client-Token"
                  onChange={(e) => setDraft({ ...draft, clientToken: e.target.value })}
                />
              </Field>
            </div>
            <a
              href={ZAPI_HELP}
              target="_blank"
              rel="noopener"
              className="-mt-1 mb-3 inline-flex items-center gap-1 text-theme-xs text-brand-600 hover:underline"
            >
              Onde encontrar esses dados na Z-API <ExternalLink size={12} />
            </a>
          </>
        )}
        {error && <p className="mb-3 text-theme-sm text-error-600">{error}</p>}
        <div className="flex gap-2">
          <TaButton variant="primary" startIcon={draft.id ? undefined : <Plus size={15} />} onClick={() => void save()}>
            {draft.id ? "Salvar" : "Adicionar número"}
          </TaButton>
          {draft.id && <TaButton onClick={() => setDraft(EMPTY)}>Cancelar</TaButton>}
        </div>
      </div>
      <p className="mt-4 text-theme-xs text-gray-500">
        O WhatsApp Web só aceita um número por perfil do Chrome, e o CRM só enxerga o perfil em que está instalado. O número que fica aberto em outro perfil
        entra como <b>Manual</b> (ou pela Z-API, para envio automático).
      </p>
    </TaPanel>
  );
}
