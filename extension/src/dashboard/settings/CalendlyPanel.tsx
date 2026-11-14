// Configurações → Integrações → Calendly (spec 18): contas conectadas por token
// pessoal (fica só neste computador), link padrão de cada conta, conta usada em
// cada funil e leitura dos agendamentos (a cada 5 min, ou "Sincronizar agora").
import { useEffect, useState } from "react";
import { Eye, EyeOff, Plug, RefreshCw, Trash2 } from "lucide-react";
import { TaButton, TaInput, TaPanel, TaSelect } from "@tailadmin";
import { call } from "../../rpc/client";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { connectCalendly, loadCalendly, refreshCalendlyAccount, requestCalendlyPermission, saveCalendly, type CalendlySettings } from "../../lib/calendly";
import type { CalendlyImportResult } from "../../db/calendly";
import { useSession } from "../session";
import { Field } from "../ui/form";

type Msg = { text: string; kind: "ok" | "err" } | null;

export function CalendlyPanel() {
  const { user } = useSession();
  const [s, setS] = useState<CalendlySettings | null>(null);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    void loadCalendly().then(setS);
    void call("pipelines.list", {}).then((p) => setPipelines(p.map((x) => ({ id: x.id, name: x.name }))));
  }, []);

  if (!s) return null;
  const save = async (next: CalendlySettings) => {
    setS(next);
    await saveCalendly(next);
  };

  const connect = async () => {
    setMsg(null);
    setBusy("connect");
    try {
      if (!(await requestCalendlyPermission())) throw new Error("Sem a permissão de acesso ao Calendly não dá para conectar.");
      const acc = await connectCalendly(token);
      const fresh = await loadCalendly();
      const others = fresh.accounts.filter((a) => a.email !== acc.email);
      await save({ ...fresh, accounts: [...others, acc] });
      setToken("");
      setMsg({ kind: "ok", text: `Conta ${acc.email} conectada (${acc.eventTypes.length} link${acc.eventTypes.length === 1 ? "" : "s"} de agendamento).` });
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (email: string) => {
    setMsg(null);
    setBusy(`refresh:${email}`);
    try {
      const acc = s.accounts.find((a) => a.email === email)!;
      const upd = await refreshCalendlyAccount(acc);
      await save({ ...s, accounts: s.accounts.map((a) => (a.email === email ? upd : a)) });
      setMsg({ kind: "ok", text: `Links de ${email} atualizados.` });
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (email: string) => {
    if (!confirm(`Desconectar a conta ${email} do Calendly? As reuniões já trazidas continuam no CRM.`)) return;
    const pipelineAccount = Object.fromEntries(Object.entries(s.pipelineAccount).filter(([, v]) => v !== email));
    await save({ ...s, accounts: s.accounts.filter((a) => a.email !== email), pipelineAccount });
  };

  const syncNow = async () => {
    setMsg(null);
    setBusy("sync");
    try {
      const r = (await chrome.runtime.sendMessage({ target: "background", kind: "calendly-sync", userId: user.id })) as { ok: boolean; error?: string; result: CalendlyImportResult | null };
      if (!r?.ok) throw new Error(r?.error ?? "Não foi possível ler o Calendly.");
      const x = r.result;
      setMsg({
        kind: "ok",
        text: x && x.created + x.updated + x.canceled ? `${x.created} reunião(ões) nova(s), ${x.updated} remarcada(s), ${x.canceled} cancelada(s).` : "Nada novo no Calendly.",
      });
    } catch (e) {
      setMsg({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(null);
      setS(await loadCalendly());
    }
  };

  return (
    <TaPanel title="Calendly" subtitle="Os agendamentos feitos pelos seus links viram reuniões no cartão certo. O token fica só neste computador.">
      <div className="space-y-5 text-theme-sm" data-calendly-panel>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-theme-xs text-gray-600 dark:bg-white/5 dark:text-gray-400">
          No Calendly: <b>Integrações → API e webhooks → Tokens de acesso pessoal → Gerar novo token</b>. Copie o token e cole aqui (não envie por e-mail
          nem por chat). Dá para conectar mais de uma conta, inclusive gratuitas.
        </div>

        <div className="flex items-end gap-2">
          <Field label="Token pessoal do Calendly" className="flex-1">
            <div className="relative">
              <TaInput
                type={show ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="eyJraWQiOi…"
                autoComplete="off"
                data-calendly-token
              />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label={show ? "Ocultar" : "Mostrar"}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
          <TaButton variant="primary" startIcon={<Plug size={15} />} disabled={!token.trim() || !!busy} onClick={() => void connect()} data-calendly-connect>
            {busy === "connect" ? "Conectando…" : "Conectar conta"}
          </TaButton>
        </div>

        {s.accounts.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium text-gray-800 dark:text-white/90">Contas conectadas</p>
            {s.accounts.map((a) => (
              <div key={a.email} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700" data-calendly-account={a.email}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-gray-800 dark:text-white/90">{a.name}</span>
                    <span className="block text-theme-xs text-gray-500">{a.email}</span>
                    {!a.token && <span className="block text-theme-xs text-warning-700">Sem token neste computador: cole o token de novo e clique em Conectar conta.</span>}
                  </span>
                  <TaButton size="sm" variant="ghost" startIcon={<RefreshCw size={14} />} disabled={!!busy} onClick={() => void refresh(a.email)}>
                    Atualizar links
                  </TaButton>
                  <TaButton size="sm" variant="ghost" startIcon={<Trash2 size={14} />} onClick={() => void remove(a.email)} data-calendly-remove={a.email}>
                    Desconectar
                  </TaButton>
                </div>
                <Field label="Link enviado aos contatos" className="mt-2">
                  <TaSelect
                    value={a.eventTypeUri ?? ""}
                    onChange={(e) => void save({ ...s, accounts: s.accounts.map((x) => (x.email === a.email ? { ...x, eventTypeUri: e.target.value || null } : x)) })}
                    data-calendly-event-type={a.email}
                  >
                    {!a.eventTypes.length && <option value="">Nenhum link ativo nesta conta</option>}
                    {a.eventTypes.map((t) => (
                      <option key={t.uri} value={t.uri}>
                        {t.name} ({t.duration} min) — {t.url}
                      </option>
                    ))}
                  </TaSelect>
                </Field>
              </div>
            ))}
          </div>
        )}

        {s.accounts.length > 1 && pipelines.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium text-gray-800 dark:text-white/90">Conta de cada funil</p>
            <p className="text-theme-xs text-gray-500">O botão “Enviar link de agendamento” do cartão usa a conta escolhida para o funil dele.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {pipelines.map((p) => (
                <Field key={p.id} label={p.name}>
                  <TaSelect
                    value={s.pipelineAccount[p.id] ?? ""}
                    onChange={(e) => {
                      const map = { ...s.pipelineAccount };
                      if (e.target.value) map[p.id] = e.target.value;
                      else delete map[p.id];
                      void save({ ...s, pipelineAccount: map });
                    }}
                    data-calendly-pipeline={p.id}
                  >
                    <option value="">Padrão ({s.accounts[0]!.email})</option>
                    {s.accounts.map((a) => (
                      <option key={a.email} value={a.email}>
                        {a.email}
                      </option>
                    ))}
                  </TaSelect>
                </Field>
              ))}
            </div>
          </div>
        )}

        {s.accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
            <TaButton variant="outline" startIcon={<RefreshCw size={15} />} disabled={!!busy} onClick={() => void syncNow()} data-calendly-sync>
              {busy === "sync" ? "Lendo o Calendly…" : "Sincronizar agora"}
            </TaButton>
            <span className="text-theme-xs text-gray-500">
              Lido a cada 5 minutos com o Chrome aberto.
              {s.lastSyncAt && ` Última leitura: ${formatDateTime(s.lastSyncAt)}.`}
            </span>
            {s.lastError && <span className="w-full rounded-lg bg-error-50 px-3 py-2 text-theme-xs text-error-700">Última tentativa falhou: {s.lastError}</span>}
          </div>
        )}

        {msg && (
          <p className={msg.kind === "ok" ? "rounded-lg bg-success-50 px-3 py-2 text-success-700" : "rounded-lg bg-error-50 px-3 py-2 text-error-700"} data-calendly-msg>
            {msg.text}
          </p>
        )}
      </div>
    </TaPanel>
  );
}
