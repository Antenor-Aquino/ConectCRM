// Configurações → Integrações (spec 09): uma entrada por integração, com os
// parâmetros de cada uma: Pipedrive (chave da API, endereço da conta e o
// botão para importar) e Gestão Financeira (spec 13). Só administradores.
import { useEffect, useState } from "react";
import { CheckCircle2, Download, Eye, EyeOff, Plug, Unplug } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel, cn } from "@tailadmin";
import { errorText } from "../../lib/errors";
import {
  loadIntegrations,
  pipedriveBaseUrl,
  requestPipedrivePermission,
  saveIntegrations,
  type IntegrationsSettings as Settings,
  type PipedriveSettings,
} from "../../lib/integrations";
import { PipedriveClient } from "../../lib/pipedrive/api";
import { formatDateTime } from "../../lib/format";
import { useSession } from "../session";
import { Field } from "../ui/form";
import { PipedriveImportModal } from "./PipedriveImportModal";
import { GestaoFinanceiraPanel } from "./GestaoFinanceiraPanel";

type Msg = { text: string; kind: "ok" | "err" } | null;

const INTEGRATIONS = [
  { id: "pipedrive", name: "Pipedrive", description: "Importar leads, contatos e organizações, com de-para dos campos.", logo: "p", bg: "bg-[#1a1a1a]" },
  { id: "gestao", name: "Gestão Financeira", description: "Receitas e despesas dos cartões na extensão Gestão Financeira deste Chrome.", logo: "$", bg: "bg-success-600" },
] as const;
type IntegrationId = (typeof INTEGRATIONS)[number]["id"];

export function IntegrationsSettings() {
  const { user } = useSession();
  const [s, setS] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<IntegrationId>("pipedrive");

  useEffect(() => {
    void loadIntegrations().then(setS);
  }, []);

  if (user.role !== "admin")
    return (
      <TaPanel title="Integrações">
        <p className="text-theme-sm text-gray-600 dark:text-gray-400">Somente administradores configuram e usam as integrações.</p>
      </TaPanel>
    );
  if (!s) return null;
  const status = (p: PipedriveSettings) => (!p.token ? "Não configurada" : p.active ? "Ativa" : "Inativa");

  return (
    <>
      <TaPanel title="Integrações" subtitle="Conecte outros sistemas para importar dados. Os parâmetros ficam só neste computador (não vão para o backup).">
        <div className="grid gap-3 sm:grid-cols-2">
          {INTEGRATIONS.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => setSelected(i.id)}
              data-integration={i.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 text-left",
                selected === i.id
                  ? "border-brand-300 bg-brand-25 ring-2 ring-brand-500/10 dark:bg-brand-500/10"
                  : "border-gray-200 hover:bg-gray-50 dark:border-gray-700",
              )}
            >
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white", i.bg)}>{i.logo}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                  {i.name}
                  {i.id === "pipedrive" && <TaBadge color={s.pipedrive.token && s.pipedrive.active ? "green" : "slate"} label={status(s.pipedrive)} />}
                </span>
                <span className="mt-0.5 block text-theme-xs text-gray-500">{i.description}</span>
              </span>
            </button>
          ))}
        </div>
      </TaPanel>
      {selected === "pipedrive" && <PipedrivePanel settings={s} onChange={setS} />}
      {selected === "gestao" && <GestaoFinanceiraPanel />}
    </>
  );
}

function PipedrivePanel({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const p = settings.pipedrive;
  const [token, setToken] = useState(p.token);
  const [domain, setDomain] = useState(p.domain);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [importing, setImporting] = useState(false);

  const persist = async (next: PipedriveSettings) => {
    const all = { ...settings, pipedrive: next };
    await saveIntegrations(all);
    onChange(all);
  };

  /** Salva, pede a permissão de acesso e confere a chave na API. */
  const connect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // A permissão precisa ser pedida no clique (gesto do usuário).
      if (!(await requestPipedrivePermission())) throw new Error("Sem a permissão de acesso ao Pipedrive o ConectCRM não consegue buscar os dados.");
      const me = await new PipedriveClient(token.trim()).me();
      const next: PipedriveSettings = {
        token: token.trim(),
        domain: domain.trim() || me.company_domain || "",
        active: true,
        account: { user: me.name, email: me.email, company: me.company_name, checkedAt: new Date().toISOString() },
      };
      setDomain(next.domain);
      await persist(next);
      setMsg({ text: `Conectado à conta ${me.company_name} como ${me.name} (${me.email}).`, kind: "ok" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Desconectar o Pipedrive? A chave é apagada deste computador. Os registros já importados continuam no CRM.")) return;
    setToken("");
    await persist({ token: "", domain: p.domain, active: false });
    setMsg({ text: "Pipedrive desconectado.", kind: "ok" });
  };

  const base = pipedriveBaseUrl(domain);
  return (
    <TaPanel
      title="Pipedrive"
      subtitle="Importa leads (como cartões num funil comercial), contatos e organizações, buscando pelo nome ou pela data de criação."
    >
      <div className="grid gap-x-4 md:grid-cols-2">
        <Field label="Chave da API (token pessoal)" hint="No Pipedrive: foto do perfil → Configurações pessoais → API.">
          <div className="flex gap-2">
            <TaInput
              type={showKey ? "text" : "password"}
              autoComplete="off"
              value={token}
              placeholder="Cole aqui a chave"
              onChange={(e) => {
                setToken(e.target.value);
                setMsg(null);
              }}
              aria-label="Chave da API do Pipedrive"
            />
            <TaButton title={showKey ? "Ocultar" : "Mostrar"} onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </TaButton>
          </div>
        </Field>
        <Field label="Endereço da conta" hint={base ? `Para abrir os registros originais: ${base}` : "Preenchido ao conectar (ex.: suaempresa.pipedrive.com)."}>
          <TaInput
            value={domain}
            placeholder="suaempresa.pipedrive.com"
            onChange={(e) => setDomain(e.target.value)}
            aria-label="Endereço da conta do Pipedrive"
          />
        </Field>
      </div>
      {p.account && p.token && (
        <p className="mb-3 flex items-center gap-1.5 text-theme-sm text-gray-600 dark:text-gray-400">
          <CheckCircle2 size={15} className="text-success-500" /> Conta {p.account.company} · {p.account.user} · conferida em{" "}
          {formatDateTime(p.account.checkedAt)}
        </p>
      )}
      <label className="mb-4 flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" disabled={!p.token} checked={p.active} onChange={(e) => void persist({ ...p, active: e.target.checked })} />
        Integração ativa
      </label>
      <div className="flex flex-wrap gap-2">
        <TaButton variant="primary" disabled={busy || !token.trim()} startIcon={<Plug size={15} />} onClick={() => void connect()}>
          {busy ? "Conectando…" : p.token ? "Salvar e testar conexão" : "Conectar"}
        </TaButton>
        {p.token && (
          <TaButton startIcon={<Unplug size={15} />} onClick={() => void disconnect()}>
            Desconectar
          </TaButton>
        )}
        <TaButton disabled={!p.token || !p.active} startIcon={<Download size={15} />} onClick={() => setImporting(true)}>
          Importar do Pipedrive
        </TaButton>
      </div>
      {msg && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}>
          {msg.text}
        </p>
      )}
      {importing && <PipedriveImportModal settings={p} onClose={() => setImporting(false)} />}
    </TaPanel>
  );
}
