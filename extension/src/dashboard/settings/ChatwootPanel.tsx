// Configurações → Integrações → Chatwoot (spec 24): token e números da conta,
// inbox, agente e etiqueta do ticket de ativação Powercubus; funis em que o
// botão aparece; e os campos personalizados do cartão que a nota usa.
import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, ListPlus, MessageSquare } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Pipeline } from "../../db/pipelines";
import { errorText } from "../../lib/errors";
import { CHATWOOT_DEFAULTS, chatwootReady, loadChatwoot, requestChatwootPermission, saveChatwoot, testChatwoot, type ChatwootSettings } from "../../lib/chatwoot";
import { Field } from "../ui/form";

type Msg = { text: string; kind: "ok" | "err" } | null;

export function ChatwootPanel() {
  const [s, setS] = useState<ChatwootSettings | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [fields, setFields] = useState<{ name: string; key: string; exists: boolean; pipelineIds: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const loadFields = () => call("chatwoot.fieldsStatus").then(setFields);
  useEffect(() => {
    void loadChatwoot().then(setS);
    void call("pipelines.list", {}).then((l) => setPipelines(l.filter((p) => p.type === "comercial")));
    void loadFields();
  }, []);
  if (!s) return null;
  const set = (p: Partial<ChatwootSettings>) => setS({ ...s, ...p });
  const num = (v: string) => Math.max(0, Math.round(Number(v.replace(/\D/g, "")) || 0));

  const saveAndTest = async () => {
    // A permissão do site precisa ser pedida dentro do clique.
    const allowed = requestChatwootPermission(s).catch(() => false);
    setBusy(true);
    setMsg(null);
    try {
      if (!(await allowed)) throw new Error(`Sem a permissão de acesso a ${new URL(s.baseUrl).host} o ConectCRM não consegue falar com o Chatwoot.`);
      await saveChatwoot(s);
      const r = await testChatwoot(s);
      setMsg({ text: `Chatwoot conectado${r.user ? ` como ${r.user}` : ""}. Inbox: ${r.inbox}.`, kind: "ok" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const createFields = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call("chatwoot.ensureFields", { pipelineIds: s.pipelineIds });
      await loadFields();
      setMsg({ text: r.created.length ? `Campos criados no cartão: ${r.created.join(", ")}.` : "Os campos já existiam.", kind: "ok" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const missing = fields.filter((f) => !f.exists);
  return (
    <TaPanel
      title="Chatwoot"
      subtitle="Botão “Ativação Chatwoot” no cartão: abre um ticket no Chatwoot em nome do cliente, com a nota privada para o financeiro. O token fica só neste computador (não vai para o backup)."
    >
      <div className="space-y-4 text-theme-sm" data-chatwoot-panel>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Endereço do Chatwoot">
            <TaInput value={s.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={CHATWOOT_DEFAULTS.baseUrl} />
          </Field>
          <Field label="Token de acesso" hint="No Chatwoot: Perfil → Access Token. Use um usuário de integração.">
            <div className="flex gap-2">
              <TaInput type={showToken ? "text" : "password"} value={s.token} onChange={(e) => set({ token: e.target.value })} autoComplete="off" aria-label="Token do Chatwoot" />
              <TaButton variant="ghost" onClick={() => setShowToken((v) => !v)} aria-label={showToken ? "Esconder token" : "Mostrar token"}>
                {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </TaButton>
            </div>
          </Field>
          <Field label="Conta (account id)">
            <TaInput value={String(s.accountId)} inputMode="numeric" onChange={(e) => set({ accountId: num(e.target.value) })} />
          </Field>
          <Field label="Inbox de e-mail (inbox id)" hint="16 = Contato (contato@powercubus.com.br).">
            <TaInput value={String(s.inboxId)} inputMode="numeric" onChange={(e) => set({ inboxId: num(e.target.value) })} />
          </Field>
          <Field label="Atribuir ao agente (id)" hint="6 = Mauricio Vieira. Vazio = sem atribuição.">
            <TaInput value={s.assigneeId ? String(s.assigneeId) : ""} inputMode="numeric" onChange={(e) => set({ assigneeId: num(e.target.value) || null })} />
          </Field>
          <Field label="Etiqueta">
            <TaInput value={s.label} onChange={(e) => set({ label: e.target.value.toLowerCase().replace(/\s+/g, "-") })} />
          </Field>
          <Field label="Assunto" hint="O nome da escola é acrescentado ao final." className="md:col-span-2">
            <TaInput value={s.subjectBase} onChange={(e) => set({ subjectBase: e.target.value })} />
          </Field>
        </div>

        <Field label="Funis em que o botão aparece" hint="Nenhum marcado = todos os funis comerciais. Os campos novos também ficam só nesses funis.">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-chatwoot-pipelines>
            {pipelines.map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.pipelineIds.includes(p.id)}
                  onChange={(e) => set({ pipelineIds: e.target.checked ? [...s.pipelineIds, p.id] : s.pipelineIds.filter((x) => x !== p.id) })}
                />
                {p.name}
              </label>
            ))}
          </div>
        </Field>

        {msg && (
          <p className={msg.kind === "ok" ? "rounded-lg bg-success-50 px-3 py-2 text-success-700" : "rounded-lg bg-error-50 px-3 py-2 text-error-700"} data-chatwoot-msg>
            {msg.text}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <TaButton disabled={busy || !s.token.trim()} startIcon={<MessageSquare size={14} />} onClick={() => void saveAndTest()} data-chatwoot-save>
            Salvar e testar
          </TaButton>
          {chatwootReady(s) ? <TaBadge color="green" label="Configurado" /> : <TaBadge color="slate" label="Falta o token" />}
        </div>

        <section className="border-t border-gray-100 pt-4 dark:border-gray-800" data-chatwoot-fields>
          <p className="mb-1 font-medium text-gray-800 dark:text-white/90">Campos do cartão usados na nota</p>
          <p className="mb-2 text-theme-xs text-gray-500">
            Os outros dados vêm do cartão: responsável (contato principal), razão social, CNPJ, CEP e endereço (organização pagadora ou principal), nome da escola
            (organização principal) e valor.
          </p>
          <ul className="mb-2 space-y-1">
            {fields.map((f) => (
              <li key={f.key} className="flex items-center gap-2">
                {f.exists ? <CheckCircle2 size={14} className="text-success-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-gray-300" />}
                {f.name} <span className="font-mono text-theme-xs text-gray-400">{`{{${f.key}}}`}</span>
                {f.exists && f.pipelineIds.length > 0 && (
                  <span className="text-theme-xs text-gray-400">· {f.pipelineIds.map((id) => pipelines.find((p) => p.id === id)?.name).filter(Boolean).join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <TaButton variant="outline" disabled={busy} startIcon={<ListPlus size={14} />} onClick={() => void createFields()} data-chatwoot-create-fields>
              Criar {missing.length === fields.length ? "os campos" : `os ${missing.length} campos que faltam`}
            </TaButton>
          )}
        </section>
      </div>
    </TaPanel>
  );
}
