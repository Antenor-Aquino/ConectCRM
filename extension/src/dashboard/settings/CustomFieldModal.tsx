// "Criar campo personalizado" (mockup): nome, descrição, tipo, entidade,
// chave reservada {{…}}, Sempre mostrar / Esconder / Obrigatório; opções
// (listas) e restrição por funil (negócio, ticket, projeto).
import { useEffect, useState } from "react";
import { Asterisk, Eye, GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import { CUSTOM_FIELD_TYPE_LABEL, type CustomField, type CustomFieldEntity, type CustomFieldType } from "../../db/customFields";
import type { Pipeline } from "../../db/pipelines";
import { placeholderKeyFromName } from "../../lib/validate";
import { ErrorText, Field, SectionLabel } from "../ui/form";
import { Switch, SwitchRow } from "../ui/Switch";
import { errorText } from "../../lib/errors";

export const ENTITY_LABEL: Record<CustomFieldEntity, string> = {
  person: "Contato",
  organization: "Organização",
  deal: "Negócio",
  ticket: "Ticket",
  project: "Projeto",
  activity: "Tarefa",
  product: "Produto",
};

const PIPELINE_TYPE: Partial<Record<CustomFieldEntity, string>> = { deal: "comercial", ticket: "operacional", project: "projeto" };
const isList = (t: CustomFieldType) => t === "select" || t === "multiselect";

export function CustomFieldModal({
  field,
  defaultEntity,
  onClose,
  onSaved,
}: {
  field: CustomField | null;
  defaultEntity: CustomFieldEntity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(field?.name ?? "");
  const [description, setDescription] = useState(field?.description ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.field_type ?? "text");
  const [entity, setEntity] = useState<CustomFieldEntity>(field?.entity ?? defaultEntity);
  const [key, setKey] = useState(field?.placeholder_key ?? "");
  const [keyEdited, setKeyEdited] = useState(!!field);
  const [alwaysShow, setAlwaysShow] = useState(!!field?.always_show);
  const [hidden, setHidden] = useState(!!field?.hidden);
  const [required, setRequired] = useState(!!field?.required);
  const [active, setActive] = useState(field ? !!field.active : true);
  const [options, setOptions] = useState<{ id?: string; label: string }[]>(field?.options.map((o) => ({ id: o.id, label: o.label })) ?? []);
  const [pipelineIds, setPipelineIds] = useState<string[]>(field?.pipelineIds ?? []);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call("pipelines.list", { includeArchived: true }).then(setPipelines);
  }, []);

  // Chave sugerida a partir do nome até o usuário editá-la.
  const shownKey = keyEdited ? key : placeholderKeyFromName(name);
  const pipelineOptions = pipelines.filter((p) => p.type === PIPELINE_TYPE[entity]);

  async function save() {
    setError(null);
    const common = {
      name,
      description,
      // Sem edição manual, o banco gera a chave (e resolve repetições: _2, _3…).
      placeholderKey: keyEdited ? key || null : null,
      alwaysShow,
      hidden,
      required,
      ...(isList(type) ? { options: options.filter((o) => o.label.trim()) } : {}),
      ...(PIPELINE_TYPE[entity] ? { pipelineIds } : {}),
    };
    try {
      if (field) await call("customFields.update", { id: field.id, patch: { ...common, active } });
      else await call("customFields.create", { ...common, entity, fieldType: type });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <TaModal isOpen onClose={onClose} title={field ? "Editar campo personalizado" : "Criar campo personalizado"} width="max-w-xl">
      <Field label="Nome do campo" required>
        <TaInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Descrição">
        <TaTextarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Tipo de campo" hint={field ? "O tipo não pode ser alterado depois de criado." : undefined}>
        <TaSelect value={type} disabled={!!field} onChange={(e) => setType(e.target.value as CustomFieldType)}>
          {(Object.keys(CUSTOM_FIELD_TYPE_LABEL) as CustomFieldType[]).map((t) => (
            <option key={t} value={t}>
              {CUSTOM_FIELD_TYPE_LABEL[t]}
            </option>
          ))}
        </TaSelect>
      </Field>
      <Field label="Entidade">
        <TaSelect
          value={entity}
          disabled={!!field}
          onChange={(e) => {
            setEntity(e.target.value as CustomFieldEntity);
            setPipelineIds([]);
          }}
        >
          {(Object.keys(ENTITY_LABEL) as CustomFieldEntity[]).map((en) => (
            <option key={en} value={en}>
              {ENTITY_LABEL[en]}
            </option>
          ))}
        </TaSelect>
      </Field>
      <Field label="Chave reservada" hint="Chave placeholder que identifica esse campo no chat para ser substituído pelo valor do campo.">
        <div className="flex items-center rounded-lg border border-gray-300 font-mono text-theme-sm shadow-theme-xs focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-500/10 dark:border-gray-700">
          <span className="pl-3.5 text-brand-600">{"{{"}</span>
          <input
            className="h-10 min-w-0 flex-1 bg-transparent px-0.5 text-gray-800 outline-none dark:text-white/90"
            value={shownKey}
            onChange={(e) => {
              setKeyEdited(true);
              setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
            }}
          />
          <span className="pr-3.5 text-brand-600">{"}}"}</span>
        </div>
      </Field>

      {isList(type) && (
        <>
          <SectionLabel>Opções da lista</SectionLabel>
          {options.map((o, i) => (
            <div key={o.id ?? `n${i}`} className="mb-2 flex items-center gap-2">
              <GripVertical size={14} className="text-gray-300" />
              <TaInput value={o.label} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <button type="button" title="Remover" className="text-gray-400 hover:text-error-600" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <TaButton variant="ghost" startIcon={<Plus size={14} />} onClick={() => setOptions([...options, { label: "" }])}>
            Adicionar opção
          </TaButton>
        </>
      )}

      <div className="mt-4">
        <SwitchRow
          icon={<Eye size={18} />}
          label="Sempre mostrar"
          help="O campo aparece fora de “Mais detalhes” nos formulários e fica visível no detalhe mesmo vazio."
          checked={alwaysShow}
          onChange={(v) => {
            setAlwaysShow(v);
            if (v) setHidden(false);
          }}
        />
        <SwitchRow
          icon={<Lock size={18} />}
          label="Esconder"
          help="O campo não aparece nas telas; continua em relatórios, importação/exportação e na chave do chat."
          checked={hidden}
          onChange={(v) => {
            setHidden(v);
            if (v) {
              setAlwaysShow(false);
              setRequired(false);
            }
          }}
        />
        <SwitchRow
          icon={<Asterisk size={18} />}
          label="Obrigatório"
          help="Impede salvar o cadastro sem preencher este campo."
          checked={required}
          disabled={hidden}
          onChange={setRequired}
        />
      </div>

      {PIPELINE_TYPE[entity] && (
        <>
          <SectionLabel>Funis</SectionLabel>
          <p className="mb-2 text-theme-xs text-gray-500">Sem nenhum marcado, o campo vale para todos os funis deste tipo.</p>
          {pipelineOptions.length === 0 && <p className="text-theme-sm text-gray-400">Nenhum funil deste tipo.</p>}
          <div className="grid grid-cols-2 gap-1">
            {pipelineOptions.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={pipelineIds.includes(p.id)}
                  onChange={(e) => setPipelineIds(e.target.checked ? [...pipelineIds, p.id] : pipelineIds.filter((x) => x !== p.id))}
                />
                {p.name}
              </label>
            ))}
          </div>
        </>
      )}

      {field && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-theme-sm font-medium dark:border-gray-800">
          Campo ativo
          <Switch checked={active} onChange={setActive} />
        </div>
      )}

      <ErrorText>{error}</ErrorText>
      <div className="mt-5 flex justify-end gap-2">
        <TaButton onClick={onClose}>Cancelar</TaButton>
        <TaButton variant="primary" onClick={() => void save()}>
          Salvar
        </TaButton>
      </div>
    </TaModal>
  );
}
