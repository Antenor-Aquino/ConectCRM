// Configurações → Nota fiscal (spec 19, fase 1): empresas que emitem a NFS-e
// pelo Emissor Nacional, com o regime e o município. A empresa de cada nota é
// escolhida na hora de emitir.
import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel, TaSelect, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import { ACCESS_LABEL, DEFAULT_DESCRIPTION_TEMPLATE, NFSE_LIMITS, NFSE_TEMPLATE_VARS, SIMPLES_LABEL, SPECIAL_REGIME_LABEL, type Issuer, type IssuerAccess, type SimplesOption } from "../../db/nfse";
import { formatCnpj, formatCnpjInput, lookupCnpj } from "../../lib/cnpj";
import { errorText } from "../../lib/errors";
import { buscarMunicipios, municipioPorIbge, municipioPorNome } from "../../lib/nfse/tabelas";
import { loadNfseEnvironment, saveNfseEnvironment } from "../../lib/nfse/portal";
import type { NfseEnvironment } from "../../db/nfse";
import { useSession } from "../session";
import { Combobox, type ComboItem } from "../ui/Combobox";
import { ErrorText, Field } from "../ui/form";
import { GuardedModal } from "../ui/GuardedModal";
import { Switch } from "../ui/Switch";

const cityItem = (ibge: string | null | undefined): ComboItem | null => {
  const m = municipioPorIbge(ibge);
  return m ? { id: m.ibge, label: `${m.nome} / ${m.uf}`, sublabel: `IBGE ${m.ibge}` } : null;
};

export function NfseSettings() {
  const { user } = useSession();
  const [issuers, setIssuers] = useState<Issuer[] | null>(null);
  const [editing, setEditing] = useState<Issuer | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIssuers(await call("nfse.issuers"));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (user.role !== "admin")
    return (
      <TaPanel title="Nota fiscal de serviço">
        <p className="text-theme-sm text-gray-600 dark:text-gray-400">Somente administradores configuram as empresas emissoras.</p>
      </TaPanel>
    );
  if (!issuers) return null;

  return (
    <TaPanel
      title="Nota fiscal de serviço (NFS-e)"
      subtitle="Empresas que emitem a nota pelo Emissor Nacional. Na hora de emitir, você escolhe por qual empresa sai a nota. Os códigos de tributação ficam em Produtos e serviços."
      action={
        <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={() => setEditing("new")} data-nfse-new>
          Empresa emissora
        </TaButton>
      }
    >
      <EnvironmentChoice />
      <div className="space-y-3 text-theme-sm" data-nfse-issuers>
        {!issuers.length && (
          <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-gray-500 dark:border-gray-700">
            Nenhuma empresa emissora. Cadastre o CNPJ que emite as notas de serviço.
          </p>
        )}
        {issuers.map((i) => (
          <div key={i.id} className="flex items-start gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800" data-nfse-issuer={i.cnpj}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10">
              <Building2 size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-800 dark:text-white/90">
                {i.legal_name}
                {!i.active && <TaBadge color="slate" label="Inativa" />}
              </p>
              <p className="text-theme-xs text-gray-500">
                CNPJ {formatCnpj(i.cnpj)} · {SIMPLES_LABEL[i.simples]} · {ACCESS_LABEL[i.access]}
                {i.city_ibge && ` · ${cityItem(i.city_ibge)?.label}`}
                {i.municipal_reg && ` · IM ${i.municipal_reg}`}
              </p>
            </div>
            <button type="button" title="Editar" onClick={() => setEditing(i)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
              <Pencil size={16} />
            </button>
            <button
              type="button"
              title="Excluir"
              onClick={async () => {
                if (!confirm(`Excluir a empresa emissora ${i.legal_name}?`)) return;
                try {
                  await call("nfse.deleteIssuer", { id: i.id });
                  await load();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
              className="rounded-lg p-2 text-gray-500 hover:bg-error-50 hover:text-error-600"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <ErrorText>{error}</ErrorText>
      </div>
      {editing && (
        <IssuerModal
          issuer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </TaPanel>
  );
}

function IssuerModal({
  issuer,
  onClose,
  onSaved,
}: {
  issuer: Issuer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cnpj, setCnpj] = useState(issuer ? formatCnpj(issuer.cnpj) : "");
  const [legalName, setLegalName] = useState(issuer?.legal_name ?? "");
  const [municipalReg, setMunicipalReg] = useState(issuer?.municipal_reg ?? "");
  const [city, setCity] = useState<ComboItem | null>(() => cityItem(issuer?.city_ibge));
  const [access, setAccess] = useState<IssuerAccess>(issuer?.access ?? "a1");
  const [simples, setSimples] = useState<SimplesOption>(issuer?.simples ?? 3);
  const [regime, setRegime] = useState(issuer?.special_regime ?? 0);
  const [active, setActive] = useState(issuer ? !!issuer.active : true);
  const [descTpl, setDescTpl] = useState(issuer?.description_template ?? DEFAULT_DESCRIPTION_TEMPLATE);
  const [notesTpl, setNotesTpl] = useState(issuer?.notes_template ?? "");
  /** Último modelo em que o usuário clicou: os botões de campo inserem nele. */
  const focusRef = useRef<{ el: HTMLTextAreaElement | null; which: "desc" | "notes" }>({ el: null, which: "desc" });
  const insertField = (key: string) => {
    const { el, which } = focusRef.current;
    const token = `{${key}}`;
    const cur = which === "desc" ? descTpl : notesTpl;
    const at = el ? el.selectionStart : cur.length;
    const next = cur.slice(0, at) + token + cur.slice(el ? el.selectionEnd : cur.length);
    (which === "desc" ? setDescTpl : setNotesTpl)(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCnpj = async () => {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await lookupCnpj(cnpj.replace(/\D/g, ""));
      if (!r.ok) throw new Error(r.error);
      setLegalName(r.data.razaoSocial);
      const m = municipioPorNome(r.data.endereco.municipio, r.data.endereco.uf);
      if (m) setCity(cityItem(m.ibge));
      const sim = (v: string) => /sim|optante/i.test(v) && !/n[aã]o/i.test(v);
      setSimples(sim(r.data.mei) ? 2 : sim(r.data.simples) ? 3 : 1);
      setMsg(`Dados da Receita: ${r.data.razaoSocial}${m ? `, ${m.nome}/${m.uf}` : ""}. Confira o regime.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError(null);
    if (!city) return setError("Informe o município da empresa (é o local da prestação padrão nas notas).");
    const input = { cnpj, legalName, municipalReg, cityIbge: city?.id ?? null, access, simples, specialRegime: regime, active, descriptionTemplate: descTpl, notesTemplate: notesTpl };
    try {
      if (issuer) await call("nfse.updateIssuer", { id: issuer.id, patch: input });
      else await call("nfse.createIssuer", input);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <GuardedModal isOpen onClose={onClose} title={issuer ? "Editar empresa emissora" : "Nova empresa emissora"}>
      <div className="space-y-1" data-nfse-form>
        <div className="flex items-end gap-2">
          <Field label="CNPJ" required className="flex-1">
            <TaInput value={cnpj} onChange={(e) => setCnpj(formatCnpjInput(e.target.value))} placeholder="00.000.000/0000-00" data-nfse-cnpj />
          </Field>
          <TaButton className="mb-4" startIcon={<Search size={15} />} disabled={busy || cnpj.replace(/\D/g, "").length !== 14} onClick={() => void fetchCnpj()} data-nfse-lookup>
            {busy ? "Buscando…" : "Buscar dados"}
          </TaButton>
        </div>
        {msg && <p className="-mt-2 mb-3 text-theme-xs text-success-700">{msg}</p>}
        <Field label="Razão social" required>
          <TaInput value={legalName} onChange={(e) => setLegalName(e.target.value)} data-nfse-name />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Município" required hint="Local da prestação padrão nas notas.">
            <Combobox
              value={city}
              onChange={setCity}
              search={async (t) => buscarMunicipios(t).map((m) => cityItem(m.ibge)!)}
              placeholder="Buscar município"
            />
          </Field>
          <Field label="Inscrição municipal" hint="Opcional na nota.">
            <TaInput value={municipalReg} onChange={(e) => setMunicipalReg(e.target.value)} />
          </Field>
          <Field label="Situação no Simples Nacional">
            <TaSelect value={simples} onChange={(e) => setSimples(Number(e.target.value) as SimplesOption)} data-nfse-simples>
              {([3, 2, 1] as SimplesOption[]).map((v) => (
                <option key={v} value={v}>
                  {SIMPLES_LABEL[v]}
                </option>
              ))}
            </TaSelect>
          </Field>
          <Field label="Regime especial municipal">
            <TaSelect value={regime} onChange={(e) => setRegime(Number(e.target.value))}>
              {Object.entries(SPECIAL_REGIME_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </TaSelect>
          </Field>
          <Field label="Acesso ao Emissor Nacional" hint="Como esta empresa entra no portal.">
            <TaSelect value={access} onChange={(e) => setAccess(e.target.value as IssuerAccess)} data-nfse-access>
              {(Object.keys(ACCESS_LABEL) as IssuerAccess[]).map((a) => (
                <option key={a} value={a}>
                  {ACCESS_LABEL[a]}
                </option>
              ))}
            </TaSelect>
          </Field>
        </div>
        <div className="mb-4 rounded-xl border border-gray-200 p-3 dark:border-gray-800" data-nfse-templates>
          <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">Textos padrão das notas desta empresa</p>
          <p className="mb-3 text-theme-xs text-gray-500">
            Ponto de partida de cada nota: na hora de emitir os dois textos aparecem para você ajustar ao cliente. A observação de um cliente que já teve nota vem da última nota dele.
          </p>
          <Field label="Discriminação dos serviços" hint={`Até ${NFSE_LIMITS.description} caracteres na nota.`}>
            <TaTextarea
              rows={4}
              value={descTpl}
              onChange={(e) => setDescTpl(e.target.value)}
              onFocus={(e) => (focusRef.current = { el: e.currentTarget, which: "desc" })}
              data-nfse-desc-template
            />
          </Field>
          <Field label="Observação (informações complementares)" hint={`Até ${NFSE_LIMITS.notes} caracteres. Ex.: dados bancários, empenho, prazo de pagamento.`}>
            <TaTextarea
              rows={3}
              value={notesTpl}
              onChange={(e) => setNotesTpl(e.target.value)}
              onFocus={(e) => (focusRef.current = { el: e.currentTarget, which: "notes" })}
              data-nfse-notes-template
            />
          </Field>
          <p className="mb-1.5 text-theme-xs font-medium text-gray-600 dark:text-gray-400">Inserir campo no texto selecionado:</p>
          <div className="flex flex-wrap gap-1.5">
            {NFSE_TEMPLATE_VARS.map((v) => (
              <button
                key={v.key}
                type="button"
                title={v.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertField(v.key)}
                className="rounded-full border border-gray-200 px-2.5 py-1 text-theme-xs text-gray-700 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
                data-nfse-var={v.key}
              >
                {`{${v.key}}`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-theme-sm font-medium dark:border-gray-800">
          Ativa
          <Switch checked={active} onChange={setActive} />
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-5 flex justify-end gap-2">
        <TaButton onClick={onClose}>Cancelar</TaButton>
        <TaButton variant="primary" onClick={() => void save()} data-nfse-save>
          Salvar
        </TaButton>
      </div>
    </GuardedModal>
  );
}

/** Produção restrita (testes, sem valor fiscal) ou produção. Fica só neste computador. */
function EnvironmentChoice() {
  const [env, setEnv] = useState<NfseEnvironment | null>(null);
  useEffect(() => {
    void loadNfseEnvironment().then(setEnv);
  }, []);
  if (!env) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 p-3 text-theme-sm dark:border-gray-800" data-nfse-environment>
      <span className="font-medium text-gray-800 dark:text-white/90">Emissor Nacional:</span>
      <TaSelect
        value={env}
        onChange={async (e) => {
          const v = e.target.value as NfseEnvironment;
          if (v === "producao" && !confirm("Passar a emitir em PRODUÇÃO? As notas emitidas passam a ter valor fiscal.")) return;
          setEnv(v);
          await saveNfseEnvironment(v);
        }}
        className="w-auto"
        data-nfse-env
      >
        <option value="producao_restrita">Produção restrita (testes, sem valor fiscal)</option>
        <option value="producao">Produção (notas com valor fiscal)</option>
      </TaSelect>
      <span className="text-theme-xs text-gray-500">
        {env === "producao_restrita" ? "Use para conferir o preenchimento antes de emitir de verdade." : "As notas emitidas valem como documento fiscal."}
      </span>
    </div>
  );
}
