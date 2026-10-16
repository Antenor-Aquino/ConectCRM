// "Criar contato" / editar contato (spec 03): foto, nome, canais (e-mail e
// celular com país), organizações (a primeira vira a principal), notas,
// contato privado, mais detalhes (responsável, tags) e campos personalizados.
import { useEffect, useState } from "react";
import { AlertTriangle, PlusCircle, Star, X } from "lucide-react";
import { TaButton, TaInput, TaModal, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import type { CustomField, CustomValue } from "../../db/customFields";
import { useSession } from "../session";
import { createOrganizationQuick, searchOrganizations } from "../cards/searchers";
import { Combobox } from "../ui/Combobox";
import { CustomFieldsForm } from "../ui/CustomFieldsForm";
import { ErrorText, Field, SectionLabel } from "../ui/form";
import { ImageUpload } from "../ui/ImageUpload";
import { localPart, PhoneInput } from "../ui/PhoneInput";
import { TagPicker } from "../ui/TagPicker";
import { UserSelect } from "../ui/UserSelect";

interface OrgLink {
  id: string;
  name: string;
}

export function PersonFormModal({
  personId,
  initialName,
  onClose,
  onSaved,
  onOpenExisting,
}: {
  /** Sem id = novo contato. */
  personId: string | null;
  initialName?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
  onOpenExisting?: (id: string) => void;
}) {
  const { user } = useSession();
  const [loaded, setLoaded] = useState(!personId);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [name, setName] = useState(initialName ?? "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("BR");
  const [orgs, setOrgs] = useState<OrgLink[]>([]);
  const [orgPicker, setOrgPicker] = useState(false);
  const [notes, setNotes] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(user.id);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, CustomValue>>({});
  const [dups, setDups] = useState<{ id: string; name: string; match: "email" | "phone" }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void call("customFields.list", { entity: "person" }).then(setFields);
    if (!personId) return;
    void call("persons.get", { id: personId }).then((p) => {
      if (!p) return;
      setAvatarId(p.avatar_id);
      setName(p.name);
      setEmail(p.email ?? "");
      setCountry(p.phone_country ?? "BR");
      setPhone(localPart(p.phone, p.phone_country ?? "BR"));
      // Principal primeiro (é a ordem que define a principal ao salvar).
      setOrgs(p.organizations.map((o) => ({ id: o.id, name: o.name })));
      setNotes(p.notes ?? "");
      setIsPrivate(!!p.is_private);
      setOwnerId(p.owner_id);
      setTagIds(p.tags.map((t) => t.id));
      setValues(p.customValues);
      setLoaded(true);
    });
  }, [personId]);

  async function checkDuplicates() {
    if (!email.trim() && !phone.trim()) return setDups([]);
    setDups(await call("persons.findDuplicates", { email, phone, phoneCountry: country, excludeId: personId ?? undefined }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const input = {
      name,
      email: email || null,
      phone: phone || null,
      phoneCountry: country,
      notes,
      isPrivate,
      ownerId,
      avatarId,
      tagIds,
      customValues: values,
      organizationIds: orgs.map((o) => o.id),
    };
    try {
      let id = personId;
      if (id) await call("persons.update", { id, patch: input });
      else id = await call("persons.create", input);
      if (orgs[0]) await call("persons.setPrimaryOrganization", { personId: id, organizationId: orgs[0].id });
      onSaved(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const visibleFields = fields.filter((f) => !f.hidden);

  return (
    <TaModal isOpen onClose={onClose} title={personId ? "Editar contato" : "Criar contato"} width="max-w-xl">
      {!loaded ? (
        <p className="text-theme-sm text-gray-500">Carregando…</p>
      ) : (
        <>
          <ImageUpload value={avatarId} onChange={setAvatarId} shape="round" entityType="person" />
          <Field label="Nome" required>
            <TaInput autoFocus={!personId} value={name} placeholder="Nome do contato" onChange={(e) => setName(e.target.value)} />
          </Field>

          <SectionLabel>Canais</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="E-mail">
              <TaInput type="email" placeholder="nome@empresa.com.br" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => void checkDuplicates()} />
            </Field>
            <Field label="Celular">
              <div onBlur={() => void checkDuplicates()}>
                <PhoneInput
                  value={phone}
                  country={country}
                  onChange={(v, c) => {
                    setPhone(v);
                    setCountry(c);
                  }}
                />
              </div>
            </Field>
          </div>
          {dups.length > 0 && (
            <div className="mb-3 flex gap-2 rounded-lg bg-warning-50 p-3 text-theme-sm text-warning-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                {dups.map((d) => (
                  <p key={d.id + d.match}>
                    Já existe <b>{d.name}</b> com este {d.match === "email" ? "e-mail" : "celular"}.{" "}
                    {onOpenExisting && (
                      <button type="button" className="font-medium underline" onClick={() => onOpenExisting(d.id)}>
                        Abrir contato existente
                      </button>
                    )}
                  </p>
                ))}
              </div>
            </div>
          )}

          <SectionLabel>Organizações</SectionLabel>
          {orgs.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {orgs.map((o, i) => (
                <li key={o.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-theme-sm dark:border-gray-800">
                  <span className="flex-1 text-gray-800 dark:text-white/90">{o.name}</span>
                  {i === 0 ? (
                    <span className="flex items-center gap-1 text-theme-xs text-warning-600">
                      <Star size={12} fill="currentColor" /> Principal
                    </span>
                  ) : (
                    <button type="button" className="text-theme-xs text-gray-500 hover:text-brand-600" onClick={() => setOrgs([o, ...orgs.filter((x) => x.id !== o.id)])}>
                      Tornar principal
                    </button>
                  )}
                  <button type="button" title="Desvincular" className="text-gray-400 hover:text-error-600" onClick={() => setOrgs(orgs.filter((x) => x.id !== o.id))}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {orgPicker ? (
            <Combobox
              value={null}
              onChange={(item) => {
                if (item && !orgs.some((o) => o.id === item.id)) setOrgs([...orgs, { id: item.id, name: item.label }]);
                setOrgPicker(false);
              }}
              search={searchOrganizations}
              placeholder="Buscar organização"
              onCreate={createOrganizationQuick}
              createLabel="Criar organização"
            />
          ) : (
            <button
              type="button"
              onClick={() => setOrgPicker(true)}
              className="flex w-full flex-col items-center rounded-lg border border-dashed border-gray-300 px-3 py-3 text-theme-sm hover:bg-gray-50 dark:border-gray-700"
            >
              <span className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                <PlusCircle size={15} /> Vincular organização
              </span>
              <span className="text-theme-xs text-gray-500">Vincule a empresa em que esse contato trabalha</span>
            </button>
          )}

          <SectionLabel>Notas</SectionLabel>
          <TaTextarea rows={3} className="border-warning-200 bg-warning-25" placeholder="Escreva algo sobre esse contato..." value={notes} onChange={(e) => setNotes(e.target.value)} />

          <SectionLabel>Configurações</SectionLabel>
          <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3.5 py-3 text-theme-sm dark:border-gray-800">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              Contato privado
              <span className="block text-theme-xs font-normal text-gray-500">Visível só para o responsável, quem criou e administradores.</span>
            </span>
            <input type="checkbox" className="h-5 w-9 cursor-pointer" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          </label>

          <SectionLabel>Mais detalhes</SectionLabel>
          <Field label="Responsável">
            <UserSelect value={ownerId} onChange={setOwnerId} />
          </Field>
          <Field label="Tags">
            <TagPicker entity="person" value={tagIds} onChange={setTagIds} />
          </Field>

          {visibleFields.length > 0 && (
            <>
              <SectionLabel>Campos personalizados ({visibleFields.length})</SectionLabel>
              <CustomFieldsForm fields={fields} values={values} onChange={setValues} columns={2} />
            </>
          )}

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
