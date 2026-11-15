// Configurações → Integrações → Banco Inter (spec 22): certificado da
// integração, Client ID/Secret e conta (guardados no ConectCRM Fiscal, protegidos
// pelo Windows) e os padrões do boleto. Só o que não é segredo fica na extensão.
import { useEffect, useState } from "react";
import { CheckCircle2, FileKey, Landmark, RefreshCw, Trash2 } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel, TaSelect } from "@tailadmin";
import { errorText } from "../../lib/errors";
import { formatCents } from "../../lib/format";
import { fiscalVersion } from "../../lib/nfse/fiscal";
import {
  INTER_ENV_LABEL,
  interClear,
  interSetup,
  interStatus,
  interTestConnection,
  loadInterSettings,
  saveInterSettings,
  type InterEnv,
  type InterInfo,
  type InterSettings,
} from "../../lib/inter";
import { Field } from "../ui/form";

type Msg = { text: string; kind: "ok" | "err" } | null;

/** Versão mínima do ConectCRM Fiscal com o módulo Inter. */
export const FISCAL_INTER_MIN = "1.1.0";
export const fiscalHasInter = (v: string | null) => {
  if (!v) return false;
  const [a = 0, b = 0] = v.split(".").map(Number);
  return a > 1 || (a === 1 && b >= 1);
};

const day = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

export function InterPanel() {
  const [s, setS] = useState<InterSettings | null>(null);
  const [fiscal, setFiscal] = useState<string | null | undefined>(undefined);
  const [info, setInfo] = useState<InterInfo | null>(null);
  const [form, setForm] = useState({ clientId: "", clientSecret: "", account: "" });
  const [files, setFiles] = useState<{ cert?: { name: string; text: string }; key?: { name: string; text: string } }>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const refresh = async (env: InterEnv) => {
    const v = await fiscalVersion();
    setFiscal(v);
    if (!fiscalHasInter(v)) return setInfo(null);
    try {
      const i = await interStatus(env);
      setInfo(i);
      setForm({ clientId: i.clientId ?? "", clientSecret: "", account: i.account ?? "" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    }
  };
  useEffect(() => {
    void loadInterSettings().then((x) => {
      setS(x);
      void refresh(x.env);
    });
  }, []);
  if (!s) return null;

  const patch = async (p: Partial<InterSettings>) => {
    const next = { ...s, ...p };
    setS(next);
    await saveInterSettings(next);
  };

  const readFile = (kind: "cert" | "key") => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 64 * 1024) return setMsg({ text: `"${f.name}" é grande demais para ser ${kind === "cert" ? "o certificado" : "a chave"} do Inter.`, kind: "err" });
    const text = await f.text();
    setFiles((x) => ({ ...x, [kind]: { name: f.name, text } }));
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const i = await interSetup(s.env, {
        clientId: form.clientId,
        clientSecret: form.clientSecret,
        account: form.account,
        certPem: files.cert?.text ?? "",
        keyPem: files.key?.text ?? "",
      });
      setInfo(i);
      setFiles({});
      setForm((f) => ({ ...f, clientSecret: "" }));
      // Já confere a conexão (certificado, credenciais e permissões).
      const r = await interTestConnection(s.env);
      setMsg({ text: `Conectado ao Inter (${INTER_ENV_LABEL[s.env]}). Saldo disponível: ${formatCents(Math.round(r.available * 100))}.`, kind: "ok" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await interTestConnection(s.env);
      setMsg({ text: `Conexão com o Inter funcionando (${INTER_ENV_LABEL[s.env]}). Saldo disponível: ${formatCents(Math.round(r.available * 100))}.`, kind: "ok" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remover a configuração do Inter (${INTER_ENV_LABEL[s.env]}) deste computador? O certificado, a chave e o Client Secret são apagados do ConectCRM Fiscal.`)) return;
    await interClear(s.env);
    setFiles({});
    await refresh(s.env);
    setMsg({ text: "Configuração do Inter removida deste computador.", kind: "ok" });
  };

  const expiring = info?.notAfter && new Date(info.notAfter).getTime() - Date.now() < 90 * 86400_000;
  return (
    <TaPanel
      title="Banco Inter"
      subtitle="Cobrança com boleto + Pix pelo Inter (botão Cobrança do cartão). O certificado, a chave e o Client Secret ficam só no ConectCRM Fiscal deste computador, protegidos pelo Windows."
    >
      <div className="space-y-4 text-theme-sm" data-inter-panel>
        {fiscal === undefined ? null : !fiscalHasInter(fiscal) ? (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-warning-800" data-inter-fiscal-missing>
            {fiscal
              ? `O ConectCRM Fiscal deste computador é a versão ${fiscal}; o Inter precisa da ${FISCAL_INTER_MIN} ou mais nova. Instale a versão nova do ConectCRMFiscal.exe e reabra o Chrome.`
              : "O ConectCRM Fiscal não está instalado neste computador. Ele é quem fala com o Inter (o Inter exige o certificado da integração em cada chamada). Instale o ConectCRMFiscal.exe e reabra o Chrome."}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Ambiente:</span>
          <TaSelect
            className="w-auto"
            value={s.env}
            data-inter-env
            onChange={async (e) => {
              const v = e.target.value as InterEnv;
              if (v === "producao" && !confirm("Usar o Inter em PRODUÇÃO? As cobranças emitidas passam a ser reais.")) return;
              await patch({ env: v });
              setMsg(null);
              await refresh(v);
            }}
          >
            <option value="sandbox">{INTER_ENV_LABEL.sandbox}</option>
            <option value="producao">{INTER_ENV_LABEL.producao}</option>
          </TaSelect>
          {info?.configured ? <TaBadge color="green" label="Configurado" /> : <TaBadge color="slate" label="Não configurado" />}
        </div>
        <p className="text-theme-xs text-gray-500">
          Cada ambiente tem a sua integração no Internet Banking do Inter (Soluções para sua empresa → Minhas integrações): no Sandbox, as cobranças são de teste e dá para simular o
          pagamento.
        </p>

        {info?.configured && (
          <div className="rounded-xl border border-gray-200 p-3 text-theme-xs dark:border-gray-800" data-inter-info>
            <p className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-white/90">
              <CheckCircle2 size={14} className="text-success-600" /> Certificado: {info.subject || "—"}
            </p>
            <p className={expiring ? "text-warning-700" : "text-gray-500"}>
              Válido até {day(info.notAfter)}
              {expiring ? " — renove a integração no Internet Banking (a renovação abre 90 dias antes)." : ""}
            </p>
            <p className="text-gray-500">
              Client ID: {info.clientId} {info.account ? `· Conta ${info.account}` : "· Conta principal"}
            </p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Client ID">
            <TaInput value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} aria-label="Client ID" autoComplete="off" />
          </Field>
          <Field label="Client Secret" hint={info?.configured ? "Em branco: mantém o atual." : undefined}>
            <TaInput type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} aria-label="Client Secret" autoComplete="new-password" />
          </Field>
          <Field label="Conta corrente (opcional)" hint="Só se a integração tiver mais de uma conta.">
            <TaInput value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} aria-label="Conta corrente" inputMode="numeric" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          {(["cert", "key"] as const).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-theme-xs hover:bg-gray-50 dark:border-gray-700">
              <FileKey size={14} />
              {files[k] ? <b>{files[k]!.name}</b> : k === "cert" ? "Certificado (.crt)" : "Chave privada (.key)"}
              {info?.configured && !files[k] && <span className="text-gray-400">(mantém o atual)</span>}
              <input type="file" hidden accept={k === "cert" ? ".crt,.pem,.cer" : ".key,.pem"} onChange={(e) => void readFile(k)(e)} data-inter-file={k} />
            </label>
          ))}
        </div>

        {msg && (
          <p className={msg.kind === "ok" ? "rounded-lg bg-success-50 px-3 py-2 text-success-700" : "rounded-lg bg-error-50 px-3 py-2 text-error-700"} data-inter-msg>
            {msg.text}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <TaButton disabled={busy || !fiscalHasInter(fiscal ?? null)} startIcon={busy ? <RefreshCw size={14} className="animate-spin" /> : <Landmark size={14} />} onClick={() => void save()} data-inter-save>
            Salvar e testar
          </TaButton>
          {info?.configured && (
            <>
              <TaButton variant="outline" disabled={busy} onClick={() => void test()} data-inter-test>
                Testar conexão
              </TaButton>
              <TaButton variant="ghost" disabled={busy} startIcon={<Trash2 size={14} />} onClick={() => void remove()}>
                Remover deste computador
              </TaButton>
            </>
          )}
        </div>

        <section className="border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="mb-2 font-medium text-gray-800 dark:text-white/90">Padrões do boleto</p>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Multa após o vencimento (%)">
              <TaInput type="number" min={0} max={2} step={0.01} value={String(s.finePct)} onChange={(e) => void patch({ finePct: Math.max(0, Number(e.target.value) || 0) })} data-inter-fine />
            </Field>
            <Field label="Juros (% ao mês)">
              <TaInput type="number" min={0} step={0.01} value={String(s.interestPctMonth)} onChange={(e) => void patch({ interestPctMonth: Math.max(0, Number(e.target.value) || 0) })} data-inter-interest />
            </Field>
            <Field label="Cancelar sozinho após (dias)" hint="Depois do vencimento, de 0 a 60.">
              <TaInput
                type="number"
                min={0}
                max={60}
                value={String(s.cancelAfterDays)}
                onChange={(e) => void patch({ cancelAfterDays: Math.min(60, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                data-inter-cancel-days
              />
            </Field>
            <Field label="Mensagem no boleto (opcional)">
              <TaInput value={s.message} maxLength={78} onChange={(e) => void patch({ message: e.target.value })} placeholder="Ex.: Não receber após 30 dias" />
            </Field>
          </div>
          <p className="mt-1 text-theme-xs text-gray-500">Valem para as próximas cobranças; dá para mudar em cada cobrança. Multa: o limite legal é 2% (Código de Defesa do Consumidor).</p>
        </section>
      </div>
    </TaPanel>
  );
}
