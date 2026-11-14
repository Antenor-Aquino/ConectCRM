// Configurações → Nota fiscal (spec 19, fase 1): empresas que emitem a NFS-e
// pelo Emissor Nacional, com o regime, o município e os funis de cada uma.
import { useCallback, useEffect, useState } from "react";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel, TaSelect } from "@tailadmin";
import { call } from "../../rpc/client";
import { ACCESS_LABEL, SIMPLES_LABEL, SPECIAL_REGIME_LABEL, type Issuer, type IssuerAccess, type SimplesOption } from "../../db/nfse";
import { formatCnpj, formatCnpjInput, lookupCnpj } from "../../lib/cnpj";
import { errorText } from "../../lib/errors";
import { buscarMunicipios, municipioPorIbge, municipioPorNome } from "../../lib/nfse/tabelas";
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
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<Issuer | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIssuers(await call("nfse.issuers"));
    setPipelines((await call("pipelines.list", {})).map((p) => ({ id: p.id, name: p.name })));
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
  const pipelineName = (id: string) => pipelines.find((p) => p.id === id)?.name ?? "?";

  return (
    <TaPanel
      title="Nota fiscal de serviço (NFS-e)"
      subtitle="Empresas que emitem a nota pelo Emissor Nacional e os funis de cada uma. Os códigos de tributação ficam em Produtos e serviços."
      action={
        <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={() => setEditing("new")} data-nfse-new>
          Empresa emissora
        </TaButton>
      }
    >
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
              <p className="mt-1 text-theme-xs text-gray-600 dark:text-gray-400">
                Funis: {i.pipeline_ids.length ? i.pipeline_ids.map(pipelineName).join(", ") : issuers.filter((x) => x.active).length === 1 ? "todos (única empresa ativa)" : "nenhum"}
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
          pipelines={pipelines}
          others={issuers.filter((x) => editing === "new" || x.id !== editing.id)}
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
  pipelines,
  others,
  onClose,
  onSaved,
}: {
  issuer: Issuer | null;
  pipelines: { id: string; name: string }[];
  others: Issuer[];
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
  const [pipelineIds, setPipelineIds] = useState<string[]>(issuer?.pipeline_ids ?? []);
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
    const input = { cnpj, legalName, municipalReg, cityIbge: city?.id ?? null, access, simples, specialRegime: regime, active, pipelineIds };
    try {
      if (issuer) await call("nfse.updateIssuer", { id: issuer.id, patch: input });
      else await call("nfse.createIssuer", input);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const ownerOf = (pid: string) => others.find((o) => o.pipeline_ids.includes(pid));
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
        <Field label="Funis que emitem por esta empresa" hint="Cada funil emite por uma empresa só. Com uma única empresa ativa, ela vale para todos.">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {pipelines.map((p) => {
              const other = ownerOf(p.id);
              return (
                <label key={p.id} className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={pipelineIds.includes(p.id)}
                    onChange={(e) => setPipelineIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                    data-nfse-pipeline={p.id}
                  />
                  {p.name}
                  {other && !pipelineIds.includes(p.id) && <span className="text-theme-xs text-gray-400">(hoje: {other.legal_name})</span>}
                </label>
              );
            })}
          </div>
        </Field>
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
