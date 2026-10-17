// "Nova organização" / editar (spec 04): logo, nome fantasia, empresa (CNPJ
// com consulta automática, site, razão social, segmento, responsável),
// contato, endereço (CEP preenche), descrição, mais detalhes e contatos.
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Star, X } from "lucide-react";
import { TaButton, TaInput, TaModal, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import type { CustomField, CustomValue } from "../../db/customFields";
import { formatCepInput, lookupCep } from "../../lib/cep";
import { cnpjToOrganizationFields, formatCnpj, formatCnpjInput, lookupCnpj, type CnpjData } from "../../lib/cnpj";
import { cnpjDigits, isValidCnpj } from "../../lib/validate";
import { useSession } from "../session";
import { createPersonQuick, searchPersons } from "../cards/searchers";
import { Combobox } from "../ui/Combobox";
import { CustomFieldsSection } from "../ui/CustomFieldsSection";
import { ErrorText, Field, SectionLabel } from "../ui/form";
import { ImageUpload } from "../ui/ImageUpload";
import { SimilarNotice, useSimilar } from "../ui/SimilarNotice";
import { localPart, PhoneInput } from "../ui/PhoneInput";
import { TagPicker } from "../ui/TagPicker";
import { UserSelect } from "../ui/UserSelect";
import { errorText } from "../../lib/errors";

type Form = {
  name: string;
  cnpj: string;
  website: string;
  legalName: string;
  segment: string;
  email: string;
  phone: string;
  phoneCountry: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  country: string;
  description: string;
};

const EMPTY: Form = {
  name: "", cnpj: "", website: "", legalName: "", segment: "", email: "", phone: "", phoneCountry: "BR",
  cep: "", street: "", number: "", complement: "", district: "", city: "", state: "", country: "Brasil", description: "",
};

export function OrganizationFormModal({
  organizationId,
  initialName,
  onClose,
  onSaved,
  onOpenExisting,
}: {
  organizationId: string | null;
  initialName?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
  onOpenExisting?: (id: string) => void;
}) {
  const { user } = useSession();
  const [loaded, setLoaded] = useState(!organizationId);
  const [form, setForm] = useState<Form>({ ...EMPTY, name: initialName ?? "" });
  const [logoId, setLogoId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(user.id);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, CustomValue>>({});
  const [persons, setPersons] = useState<{ id: string; name: string; is_primary?: number }[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [cnpjData, setCnpjData] = useState<CnpjData | null>(null);
  const [cnpjMsg, setCnpjMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Só na criação: nome parecido com organização já cadastrada.
  const similar = useSimilar(form.name, () => call("similar.organizations", { name: form.name }), !organizationId && form.name.trim().length >= 3);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  /** Preenche só o que ainda está vazio (spec 04: não sobrescreve o que o usuário digitou). */
  const fillEmpty = (patch: Partial<Form>) =>
    setForm((f) => {
      const next = { ...f };
      for (const [k, v] of Object.entries(patch) as [keyof Form, string][]) if (v && !f[k].trim()) next[k] = v;
      return next;
    });

  useEffect(() => {
    void call("customFields.list", { entity: "organization" }).then(setFields);
    void call("organizations.segments").then(setSegments);
    if (!organizationId) return;
    void call("organizations.get", { id: organizationId }).then((o) => {
      if (!o) return;
      setForm({
        name: o.name,
        cnpj: o.cnpj ? formatCnpj(o.cnpj) : "",
        website: o.website ?? "",
        legalName: o.legal_name ?? "",
        segment: o.segment ?? "",
        email: o.email ?? "",
        phone: localPart(o.phone, o.phone_country ?? "BR"),
        phoneCountry: o.phone_country ?? "BR",
        cep: o.cep ? formatCepInput(o.cep) : "",
        street: o.street ?? "",
        number: o.number ?? "",
        complement: o.complement ?? "",
        district: o.district ?? "",
        city: o.city ?? "",
        state: o.state ?? "",
        country: o.country ?? "Brasil",
        description: o.description ?? "",
      });
      setLogoId(o.logo_id);
      setOwnerId(o.owner_id);
      setTagIds(o.tags.map((t) => t.id));
      setValues(o.customValues);
      setPersons(o.persons);
      setLoaded(true);
    });
  }, [organizationId]);

  async function onCnpj(value: string) {
    const masked = formatCnpjInput(value);
    set({ cnpj: masked });
    setCnpjMsg(null);
    const digits = cnpjDigits(masked);
    if (digits.length !== 14) return;
    if (!isValidCnpj(digits)) return setCnpjMsg({ text: "CNPJ inválido.", warn: true });
    const dup = await call("organizations.findByCnpj", { cnpj: digits });
    if (dup && dup.id !== organizationId) return setCnpjMsg({ text: `CNPJ já cadastrado em "${dup.name}".`, warn: true });
    setLookingUp(true);
    const r = await lookupCnpj(digits);
    setLookingUp(false);
    if (!r.ok) return setCnpjMsg({ text: `${r.error} Preencha os dados manualmente.`, warn: true });
    setCnpjData(r.data);
    fillEmpty(cnpjToOrganizationFields(r.data));
    setCnpjMsg({ text: `Dados da Receita (${r.sources.join(", ")})${r.data.situacao ? ` · Situação: ${r.data.situacao}` : ""}` });
  }

  async function onCep(value: string) {
    const masked = formatCepInput(value);
    set({ cep: masked });
    if (masked.replace(/\D/g, "").length !== 8) return;
    const addr = await lookupCep(masked);
    if (addr) set({ street: addr.street || form.street, district: addr.district || form.district, city: addr.city, state: addr.state });
  }

  async function save(force = false) {
    if (!force && !(await similar.confirm())) return;
    setSaving(true);
    setError(null);
    const input = {
      ...form,
      phone: form.phone || null,
      cnpj: form.cnpj || null,
      ownerId,
      logoId,
      tagIds,
      customValues: values,
      personIds: persons.map((p) => p.id),
      ...(cnpjData ? { cnpjData } : {}),
    };
    try {
      let id = organizationId;
      if (id) await call("organizations.update", { id, patch: input });
      else id = await call("organizations.create", input);
      onSaved(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const text = (key: keyof Form, placeholder?: string) => (
    <TaInput value={form[key]} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value })} />
  );

  return (
    <TaModal isOpen onClose={onClose} title={organizationId ? "Editar organização" : "Nova organização"} width="max-w-xl">
      {!loaded ? (
        <p className="text-theme-sm text-gray-500">Carregando…</p>
      ) : (
        <>
          <ImageUpload value={logoId} onChange={setLogoId} shape="square" entityType="organization" />
          <Field label="Nome da organização" required>
            <TaInput autoFocus={!organizationId} value={form.name} placeholder="Nome fantasia" onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <SimilarNotice
            state={similar}
            openLabel="Abrir existente"
            onOpen={onOpenExisting && ((i) => onOpenExisting(i.id))}
            onContinue={() => void save(true)}
          />

          <SectionLabel>Empresa</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CNPJ">
              <div className="relative">
                <TaInput value={form.cnpj} placeholder="00.000.000/0000-00" onChange={(e) => void onCnpj(e.target.value)} />
                {lookingUp && <Loader2 size={16} className="absolute right-3 top-3 animate-spin text-gray-400" />}
              </div>
            </Field>
            <Field label="Site">{text("website", "empresa.com.br")}</Field>
          </div>
          {cnpjMsg && (
            <p className={`-mt-1 mb-3 flex items-center gap-1.5 text-theme-xs ${cnpjMsg.warn ? "text-warning-700" : "text-success-700"}`}>
              {cnpjMsg.warn && <AlertTriangle size={13} />}
              {cnpjMsg.text}
            </p>
          )}
          <Field label="Razão social">{text("legalName")}</Field>
          <Field label="Segmento">
            <TaInput list="conectcrm-segments" value={form.segment} placeholder="Digite o segmento" onChange={(e) => set({ segment: e.target.value })} />
            <datalist id="conectcrm-segments">
              {segments.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Responsável">
            <UserSelect value={ownerId} onChange={setOwnerId} />
          </Field>

          <SectionLabel>Contato</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone">
              <PhoneInput value={form.phone} country={form.phoneCountry} onChange={(v, c) => set({ phone: v, phoneCountry: c })} placeholder="(11) 3333-4444" />
            </Field>
            <Field label="E-mail">
              <TaInput type="email" value={form.email} placeholder="contato@empresa.com.br" onChange={(e) => set({ email: e.target.value })} />
            </Field>
          </div>

          <SectionLabel>Endereço</SectionLabel>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <TaInput value={form.cep} placeholder="CEP" onChange={(e) => void onCep(e.target.value)} />
            {text("street", "Logradouro")}
            {text("number", "Número")}
            {text("complement", "Complemento")}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {text("district", "Bairro")}
            {text("city", "Cidade")}
            {text("state", "Estado")}
            {text("country", "País")}
          </div>

          <SectionLabel>Descrição</SectionLabel>
          <TaTextarea rows={3} placeholder="Contexto e informações relevantes sobre a empresa" value={form.description} onChange={(e) => set({ description: e.target.value })} />

          <SectionLabel>Mais detalhes</SectionLabel>
          <Field label="Tags">
            <TagPicker entity="organization" value={tagIds} onChange={setTagIds} />
          </Field>
          <CustomFieldsSection
            entity="organization"
            fields={fields}
            values={values}
            onChange={setValues}
            onFieldsChanged={() => void call("customFields.list", { entity: "organization" }).then(setFields)}
          />

          <SectionLabel>Contatos</SectionLabel>
          {persons.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {persons.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-theme-sm dark:border-gray-800">
                  <span className="flex-1 text-gray-800 dark:text-white/90">{p.name}</span>
                  {!!p.is_primary && (
                    <span className="flex items-center gap-1 text-theme-xs text-warning-600" title="Organização principal deste contato">
                      <Star size={12} fill="currentColor" /> Principal
                    </span>
                  )}
                  <button type="button" title="Desvincular" className="text-gray-400 hover:text-error-600" onClick={() => setPersons(persons.filter((x) => x.id !== p.id))}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Combobox
            value={null}
            onChange={(item) => item && !persons.some((p) => p.id === item.id) && setPersons([...persons, { id: item.id, name: item.label }])}
            search={searchPersons}
            placeholder="Buscar contato para vincular"
            onCreate={createPersonQuick}
            createLabel="Criar contato"
          />
          <p className="mt-1 text-theme-xs text-gray-500">Se for a primeira organização do contato, o vínculo vira o principal.</p>

          <ErrorText>{error}</ErrorText>
          <div className="mt-5 flex gap-2">
            <TaButton variant="primary" disabled={saving} onClick={() => void save()}>
              Salvar
            </TaButton>
            <TaButton onClick={onClose}>Cancelar</TaButton>
          </div>
        </>
      )}
    </TaModal>
  );
}
