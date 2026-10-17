// Renderiza os campos personalizados de uma entidade conforme o tipo
// (spec 01, seção 9). Campos "Esconder" não aparecem; "Sempre mostrar" e
// "Obrigatório" ficam fora da seção recolhida "Mais detalhes".
import { useEffect, useState } from "react";
import { TaInput, TaSelect, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import { searchOrganizations, searchPersons } from "../cards/searchers";
import { DocumentFieldInput } from "../documents/DocumentField";
import { Combobox, type ComboItem } from "./Combobox";
import type { CustomField, CustomValue } from "../../db/customFields";
import { Field } from "./form";
import { MoneyInput } from "./MoneyInput";
import { UserSelect } from "./UserSelect";

export function isProminent(f: CustomField): boolean {
  return !!f.always_show || !!f.required;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Campo que aponta para um contato ou organização (guarda o id). */
function RefInput({ kind, value, onChange }: { kind: "person" | "organization"; value: string | null; onChange: (id: string | null) => void }) {
  const [item, setItem] = useState<ComboItem | null>(null);
  useEffect(() => {
    if (!value) return setItem(null);
    if (item?.id === value) return;
    const load = kind === "person" ? call("persons.get", { id: value }) : call("organizations.get", { id: value });
    void load.then((r) => setItem(r ? { id: r.id, label: r.name } : null));
  }, [value, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Combobox
      value={item}
      onChange={(i) => {
        setItem(i);
        onChange(i?.id ?? null);
      }}
      search={kind === "person" ? searchPersons : searchOrganizations}
      placeholder={kind === "person" ? "Buscar contato" : "Buscar organização"}
    />
  );
}

function FieldInput({ field, value, onChange }: { field: CustomField; value: CustomValue | undefined; onChange: (v: CustomValue) => void }) {
  const str = value == null ? "" : String(value);
  switch (field.field_type) {
    case "textarea":
      return <TaTextarea rows={3} value={str} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <TaInput type="number" value={str} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "money":
      return <MoneyInput value={typeof value === "number" ? value : 0} onChange={(c) => onChange(c || null)} />;
    case "date":
      return <TaInput type="date" value={str} onChange={(e) => onChange(e.target.value || null)} />;
    case "datetime":
      return (
        <TaInput
          type="datetime-local"
          value={str ? toLocalInput(str) : ""}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case "boolean":
      return (
        <TaSelect value={value === true ? "1" : value === false ? "0" : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "1")}>
          <option value="">—</option>
          <option value="1">Sim</option>
          <option value="0">Não</option>
        </TaSelect>
      );
    case "select":
      return (
        <TaSelect value={str} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </TaSelect>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
          {field.options.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5 text-theme-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id))}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "user":
      return <UserSelect value={str || null} onChange={(id) => onChange(id)} />;
    case "email":
      return <TaInput type="email" value={str} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <TaInput type="url" value={str} onChange={(e) => onChange(e.target.value)} />;
    case "person":
    case "organization":
      return <RefInput kind={field.field_type} value={str || null} onChange={onChange} />;
    case "document":
      return <DocumentFieldInput value={str || null} onChange={onChange} />;
    default:
      // text, phone
      return <TaInput value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function CustomFieldsForm({
  fields,
  values,
  onChange,
  columns = 1,
}: {
  fields: CustomField[];
  values: Record<string, CustomValue>;
  onChange: (values: Record<string, CustomValue>) => void;
  columns?: 1 | 2;
}) {
  const visible = fields.filter((f) => !f.hidden);
  if (visible.length === 0) return null;
  return (
    <div className={columns === 2 ? "grid grid-cols-2 gap-x-4" : ""}>
      {visible.map((f) => (
        <Field key={f.id} label={f.name} required={!!f.required} hint={f.description}>
          <FieldInput field={f} value={values[f.id]} onChange={(v) => onChange({ ...values, [f.id]: v })} />
        </Field>
      ))}
    </div>
  );
}
