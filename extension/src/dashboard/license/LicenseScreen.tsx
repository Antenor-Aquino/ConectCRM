// Tela de licença - mesmos fluxos do wa-pipedrive: ativar chave, ativar com
// código do WhatsApp, teste grátis de 7 dias, assinar mensal/anual, upgrade
// mensal → anual, atualizar pagamento e cancelar assinatura.
import { useEffect, useState } from "react";
import { ArrowLeft, Gift, KeyRound, Lightbulb } from "lucide-react";
import { TaButton, TaInput, TaModal, TaTextarea, cn } from "@tailadmin";
import {
  formatKeyInput,
  KEY_PREFIX,
  LICENSE_REASON,
  planLabel,
  PLAN_PRICES,
  type LicenseClient,
  type LicenseResult,
} from "../../lib/license";
import { isValidEmail } from "../../lib/validate";

type Msg = { text: string; kind: "ok" | "err" | "info" } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  const cls = { ok: "bg-success-50 text-success-700", err: "bg-error-50 text-error-700", info: "bg-brand-50 text-brand-700" }[msg.kind];
  return <p className={cn("mt-3 rounded-lg px-3 py-2 text-theme-sm", cls)}>{msg.text}</p>;
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-theme-xs uppercase text-gray-400">
      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      {label}
      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}

export function LicenseScreen({
  client,
  result,
  onBack,
  onActivated,
}: {
  client: LicenseClient;
  result: LicenseResult;
  onBack?: () => void;
  onActivated: () => void;
}) {
  const plan = (result.dados?.plano ?? "").toLowerCase();
  const valid = result.valida;
  const paid = valid && (plan === "mensal" || plan === "anual");
  const trialActive = valid && plan === "trial";

  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<Msg>(
    valid ? { text: `Licença ativa — ${planLabel(result.dados)}`, kind: "ok" } : LICENSE_REASON[result.motivo ?? ""] ? { text: LICENSE_REASON[result.motivo!]!, kind: "err" } : null,
  );
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeEmail, setCodeEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState<Msg>(null);
  const [terms, setTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [trialEmail, setTrialEmail] = useState("");
  const [trialPhone, setTrialPhone] = useState("");
  const [shopMsg, setShopMsg] = useState<Msg>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    void client.savedKey().then(setSavedKey);
    void client.termsAccepted().then((a) => {
      setTermsAccepted(a || valid);
      setTerms(a || valid);
    });
  }, [client, valid]);

  const requireTerms = () => {
    if (terms) return true;
    setShopMsg({ text: "Para continuar, marque que concorda com a Política de Privacidade e os Termos de Uso.", kind: "err" });
    return false;
  };

  async function activate(k: string) {
    if (!k) {
      setStatus({ text: "Digite a chave.", kind: "err" });
      return;
    }
    setStatus({ text: "Validando…", kind: "info" });
    try {
      const r = await client.activate(k);
      if (r.valida) {
        setStatus({ text: `Licença ativa — ${planLabel(r.dados)}`, kind: "ok" });
        setTimeout(onActivated, 800);
      } else setStatus({ text: LICENSE_REASON[r.motivo ?? ""] || "Chave não aceita.", kind: "err" });
    } catch {
      setStatus({ text: "Erro de conexão ao ativar. Verifique sua internet.", kind: "err" });
    }
  }

  async function validateCode() {
    const email = codeEmail.trim() || trialEmail.trim();
    if (!isValidEmail(email)) return setCodeMsg({ text: "Informe o e-mail usado no teste ou na compra.", kind: "err" });
    if (code.replace(/\D/g, "").length < 4) return setCodeMsg({ text: "Digite o código que chegou no seu WhatsApp.", kind: "err" });
    setCodeMsg({ text: "Validando código…", kind: "info" });
    try {
      const r = await client.validateCode(email, code);
      if (r.ok && r.result?.valida) {
        setCodeMsg({ text: "Código válido! Licença ativada.", kind: "ok" });
        setTimeout(onActivated, 800);
      } else if (r.ok) setCodeMsg({ text: LICENSE_REASON[r.result?.motivo ?? ""] || "Licença não aceita.", kind: "err" });
      else {
        const m: Record<string, string> = {
          codigo_invalido: "Código incorreto. Confira e tente de novo.",
          expirado: 'Código expirado. Clique em "reenviar" para receber um novo.',
          sem_otp: 'Nenhum código pendente. Clique em "reenviar" primeiro.',
        };
        setCodeMsg({ text: m[r.erro ?? ""] ?? "Não foi possível validar agora. Tente novamente.", kind: "err" });
      }
    } catch {
      setCodeMsg({ text: "Erro de conexão. Verifique sua internet.", kind: "err" });
    }
  }

  async function resendCode() {
    const email = codeEmail.trim() || trialEmail.trim();
    if (!isValidEmail(email)) return setCodeMsg({ text: "Informe o e-mail usado no teste ou na compra.", kind: "err" });
    setCodeMsg({ text: "Reenviando por WhatsApp…", kind: "info" });
    try {
      const r = await client.resendCode(email);
      const m: Record<string, string> = {
        sem_telefone: "Não há WhatsApp cadastrado para esse e-mail.",
        nao_encontrado: "Não encontramos uma licença para esse e-mail.",
        aguarde: "Aguarde um minuto antes de reenviar.",
      };
      setCodeMsg(r.ok ? { text: "Enviamos um código de 8 dígitos para o seu WhatsApp.", kind: "ok" } : { text: m[r.erro ?? ""] ?? "Não foi possível reenviar agora.", kind: "err" });
    } catch {
      setCodeMsg({ text: "Erro de conexão. Verifique sua internet.", kind: "err" });
    }
  }

  async function startTrial() {
    if (!requireTerms()) return;
    if (!isValidEmail(trialEmail.trim())) return setShopMsg({ text: "Informe um e-mail válido para iniciar o teste.", kind: "err" });
    if (trialPhone.replace(/\D/g, "").length < 10) return setShopMsg({ text: "Informe seu WhatsApp com DDD para iniciar o teste.", kind: "err" });
    setShopMsg({ text: "Gerando seu teste de 7 dias…", kind: "info" });
    try {
      const r = await client.startTrial(trialEmail.trim(), trialPhone);
      if (r.ok) {
        setShopMsg({ text: "Teste criado! Enviamos um código de 8 dígitos para o seu WhatsApp. Digite-o abaixo para ativar.", kind: "ok" });
        setCodeEmail(trialEmail.trim());
        setCodeOpen(true);
      } else if (r.erro === "trial_ja_usado" || r.erro === "email_ja_usou_trial") {
        setShopMsg({ text: `${r.mensagem ?? "Teste já utilizado."} Assine um plano para continuar.`, kind: "err" });
      } else setShopMsg({ text: r.mensagem ?? "Não foi possível gerar o teste. Tente de novo.", kind: "err" });
    } catch {
      setShopMsg({ text: "Erro de conexão ao gerar o teste.", kind: "err" });
    }
  }

  async function checkout(p: "mensal" | "anual") {
    if (!requireTerms()) return;
    setShopMsg({ text: "Abrindo pagamento…", kind: "info" });
    try {
      await chrome.tabs.create({ url: await client.checkoutUrl(p) });
      setShopMsg({ text: 'Após o pagamento você receberá um código no WhatsApp. Volte aqui, clique em "Ativar com código recebido no WhatsApp" e informe o código.', kind: "info" });
    } catch (e) {
      setShopMsg({ text: e instanceof Error ? e.message : "Erro de conexão ao abrir o pagamento.", kind: "err" });
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50 p-4 pt-12 dark:bg-gray-950">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-theme-md dark:border-gray-800 dark:bg-gray-900">
        {onBack && (
          <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-theme-sm text-gray-500 hover:text-brand-600">
            <ArrowLeft size={15} /> Voltar
          </button>
        )}
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white">
            <KeyRound size={17} />
          </span>
          <h1 className="text-theme-xl font-semibold text-gray-800 dark:text-white/90">Licença do ConectCRM</h1>
        </div>
        <Status msg={status} />

        {!paid && (
          <div className="mt-5">
            <span className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Chave de licença</span>
            <div className="flex overflow-hidden rounded-lg border border-gray-300 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-500/10 dark:border-gray-700">
              {!savedKey && <span className="flex items-center bg-gray-50 px-3 text-theme-sm text-gray-500 dark:bg-white/5">{KEY_PREFIX}</span>}
              <input
                className="h-10 flex-1 bg-transparent px-3 text-theme-sm tracking-wider outline-none"
                type={savedKey && !key ? "password" : "text"}
                placeholder={savedKey ? "**** salva (chave atual)" : "XXXX-XXXX-XXXX"}
                value={key}
                onChange={(e) => setKey(formatKeyInput(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && void activate(key || savedKey || "")}
              />
            </div>
            <TaButton variant="primary" size="md" className="mt-3 w-full" onClick={() => void activate(key || savedKey || "")}>
              Ativar licença
            </TaButton>
            <button type="button" className="mt-2 w-full text-center text-theme-sm text-brand-600 hover:underline" onClick={() => setCodeOpen(true)}>
              Ativar com código recebido no WhatsApp
            </button>
            {codeOpen && (
              <div className="mt-3 space-y-2">
                <TaInput type="email" placeholder="Seu e-mail (do teste ou da compra)" value={codeEmail} onChange={(e) => setCodeEmail(e.target.value)} />
                <TaInput inputMode="numeric" maxLength={9} placeholder="Código de 8 dígitos do WhatsApp" value={code} onChange={(e) => setCode(e.target.value)} />
                <TaButton variant="primary" className="w-full" onClick={() => void validateCode()}>
                  Validar código e ativar
                </TaButton>
                <button type="button" className="w-full text-center text-theme-xs text-gray-500 hover:text-brand-600" onClick={() => void resendCode()}>
                  Não recebi — reenviar código por WhatsApp
                </button>
              </div>
            )}
            <Status msg={codeMsg} />
          </div>
        )}

        {!termsAccepted && (
          <label className="mt-5 flex items-start gap-2 text-theme-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={terms}
              onChange={(e) => {
                setTerms(e.target.checked);
                if (e.target.checked) void client.acceptTerms();
              }}
            />
            <span>
              Li e concordo com a{" "}
              <a className="text-brand-600 underline" href="https://claudiacrm.com.br/privacidade" target="_blank" rel="noopener">
                Política de Privacidade
              </a>{" "}
              e os{" "}
              <a className="text-brand-600 underline" href="https://claudiacrm.com.br/termos" target="_blank" rel="noopener">
                Termos de Uso
              </a>
              .
            </span>
          </label>
        )}

        {!valid && !trialActive && (
          <>
            <Divider label="ou" />
            <div className="space-y-2">
              <TaInput type="email" placeholder="Seu e-mail para o teste" value={trialEmail} onChange={(e) => setTrialEmail(e.target.value)} />
              <TaInput type="tel" placeholder="WhatsApp com DDD (ex.: 11 99999-8888)" value={trialPhone} onChange={(e) => setTrialPhone(e.target.value)} />
              <TaButton variant="primary" size="md" className="w-full" startIcon={<Gift size={16} />} onClick={() => void startTrial()}>
                Testar grátis por 7 dias
              </TaButton>
              <p className="text-center text-theme-xs text-gray-500">Sem cartão. A chave é enviada para o seu e-mail.</p>
            </div>
          </>
        )}

        {paid && plan === "mensal" && (
          <div className="mt-5 flex gap-2 rounded-lg bg-warning-50 p-3 text-theme-sm text-warning-800">
            <Lightbulb size={16} className="mt-0.5 shrink-0" />
            <span>
              Você está no plano <b>Mensal</b>. No <b>Anual</b> você economiza e ainda ganha crédito pelos dias restantes.{" "}
              <button type="button" className="font-medium underline" onClick={() => setUpgradeOpen(true)}>
                Ver condições de upgrade →
              </button>
            </span>
          </div>
        )}

        <Divider label="assinar" />
        <div className="grid grid-cols-2 gap-3">
          {(["mensal", "anual"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void checkout(p)}
              className={cn(
                "rounded-xl border p-4 text-left transition hover:shadow-theme-sm",
                p === "anual" ? "border-brand-300 bg-brand-25 dark:bg-brand-500/10" : "border-gray-200 dark:border-gray-800",
              )}
            >
              <span className="block text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                {p === "mensal" ? "Mensal" : "Anual"} {paid && plan === p && <span className="text-success-600">(Contratado)</span>}
              </span>
              <span className="block text-base font-semibold text-brand-600">{PLAN_PRICES[p].price}</span>
              <span className="block text-theme-xs text-gray-500">{PLAN_PRICES[p].note}</span>
            </button>
          ))}
        </div>
        <Status msg={shopMsg} />

        {paid && (
          <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            <TaButton
              onClick={async () => {
                try {
                  await chrome.tabs.create({ url: await client.billingPortalUrl() });
                } catch (e) {
                  setShopMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
                }
              }}
            >
              Atualizar pagamento
            </TaButton>
            <TaButton variant="ghost" onClick={() => setCancelOpen(true)}>
              Cancelar assinatura
            </TaButton>
          </div>
        )}
      </div>
      {upgradeOpen && <UpgradeModal client={client} onClose={() => setUpgradeOpen(false)} />}
      {cancelOpen && <CancelModal client={client} onClose={() => setCancelOpen(false)} />}
    </div>
  );
}

const brl = (v: number | undefined) => `R$ ${Number(v ?? 0).toFixed(2).replace(".", ",")}`;

function UpgradeModal({ client, onClose }: { client: LicenseClient; onClose: () => void }) {
  const [calc, setCalc] = useState<Awaited<ReturnType<LicenseClient["upgradePreview"]>> | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    client.upgradePreview().then(setCalc, () => setMsg({ text: "Erro de conexão ao calcular o upgrade.", kind: "err" }));
  }, [client]);
  const rows: [string, string, string?][] = calc?.ok
    ? [
        ["Plano atual", `Mensal (${brl(calc.valor_mensal)}/mês)`],
        ["Dias do ciclo", `${calc.dias_plano} dias`],
        ["Dias já utilizados", `${calc.dias_utilizados} dias`],
        ["Dias de crédito", `${calc.dias_credito} dias`],
        ["Valor por dia", brl(calc.valor_diario)],
        ["Crédito proporcional", `- ${brl(calc.credito)}`, "text-success-600"],
        ["Plano Anual", brl(calc.valor_anual)],
        ["Total a pagar hoje", brl(calc.valor_final), "font-semibold text-gray-900 dark:text-white"],
      ]
    : [];
  return (
    <TaModal isOpen onClose={onClose} title="Upgrade para o plano Anual">
      <p className="mb-3 text-theme-sm text-gray-600 dark:text-gray-300">
        Ao migrar do Mensal para o Anual, você recebe um <b>crédito proporcional</b> pelos dias que restavam do seu mês.
      </p>
      {!calc && !msg && <p className="text-theme-sm text-gray-500">Calculando…</p>}
      {calc && !calc.ok && <p className="text-theme-sm text-error-600">Não foi possível calcular o upgrade{calc.motivo ? ` (${calc.motivo})` : ""}.</p>}
      {rows.map(([label, value, cls]) => (
        <div key={label} className={cn("flex justify-between border-b border-gray-100 py-1.5 text-theme-sm dark:border-gray-800", cls)}>
          <span>{label}</span>
          <b>{value}</b>
        </div>
      ))}
      <Status msg={msg} />
      {calc?.ok && (
        <TaButton
          variant="primary"
          className="mt-4 w-full"
          onClick={async () => {
            try {
              await chrome.tabs.create({ url: await client.upgradeCheckoutUrl() });
            } catch (e) {
              setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
            }
          }}
        >
          Seguir com a contratação do Anual
        </TaButton>
      )}
      <p className="mt-3 text-theme-xs text-gray-500">Sua assinatura mensal é cancelada automaticamente após a confirmação do pagamento do plano anual.</p>
    </TaModal>
  );
}

function CancelModal({ client, onClose }: { client: LicenseClient; onClose: () => void }) {
  const [reasons, setReasons] = useState<{ id: string; texto: string; tipo: string }[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    client.cancelReasons().then(setReasons, () => setMsg({ text: "Erro ao carregar motivos.", kind: "err" }));
  }, [client]);
  const open = reasons?.find((r) => r.id === selected)?.tipo === "aberto";
  return (
    <TaModal isOpen onClose={onClose} title="Cancelar assinatura" accent="var(--color-error-500)">
      {!reasons && !msg && <p className="text-theme-sm text-gray-500">Carregando motivos…</p>}
      <div className="space-y-1.5">
        {reasons?.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
            <input type="radio" name="motivo" checked={selected === r.id} onChange={() => setSelected(r.id)} />
            {r.texto}
          </label>
        ))}
      </div>
      {open && <TaTextarea className="mt-3" rows={3} placeholder="Descreva o motivo" value={text} onChange={(e) => setText(e.target.value)} />}
      <Status msg={msg} />
      <div className="mt-4 flex justify-end gap-2">
        <TaButton onClick={onClose}>Voltar</TaButton>
        <TaButton
          variant="danger"
          disabled={done}
          onClick={async () => {
            if (!selected) return setMsg({ text: "Selecione um motivo.", kind: "err" });
            if (open && !text.trim()) return setMsg({ text: "Descreva o motivo.", kind: "err" });
            setMsg({ text: "Enviando solicitação…", kind: "info" });
            try {
              const r = await client.cancel(selected, open ? text.trim() : "");
              if (r.ok) {
                setDone(true);
                setMsg({
                  text: r.reembolso
                    ? "Solicitação registrada! Você está dentro dos 7 dias — pedimos o reembolso integral. A confirmação chega por e-mail."
                    : "Solicitação registrada! A assinatura não será renovada e você mantém o acesso até o fim do período pago.",
                  kind: "ok",
                });
              } else setMsg({ text: r.erro === "nao_encontrada" ? "Licença não encontrada." : "Não foi possível registrar agora. Tente novamente.", kind: "err" });
            } catch {
              setMsg({ text: "Erro de conexão.", kind: "err" });
            }
          }}
        >
          Confirmar cancelamento
        </TaButton>
      </div>
    </TaModal>
  );
}
