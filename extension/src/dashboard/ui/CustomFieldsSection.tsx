// Seção "Campos personalizados" dos formulários de contato e organização,
// com "+ Novo campo": cria o campo ali mesmo (sem ir a Configurações).
import { useState } from "react";
import { Plus } from "lucide-react";
import type { CustomField, CustomFieldEntity, CustomValue } from "../../db/customFields";
import { CustomFieldModal } from "../settings/CustomFieldModal";
import { useSession } from "../session";
import { CustomFieldsForm } from "./CustomFieldsForm";

export function CustomFieldsSection({
  entity,
  fields,
  values,
  onChange,
  onFieldsChanged,
}: {
  entity: CustomFieldEntity;
  fields: CustomField[];
  values: Record<string, CustomValue>;
  onChange: (values: Record<string, CustomValue>) => void;
  /** Recarrega a lista de campos depois de criar um. */
  onFieldsChanged: () => void;
}) {
  const { user } = useSession();
  const [creating, setCreating] = useState(false);
  const visible = fields.filter((f) => !f.hidden);
  return (
    <>
      <div className="mb-2 mt-5 flex items-center justify-between">
        <span className="text-theme-xs font-semibold uppercase tracking-wide text-gray-400">Campos personalizados{visible.length ? ` (${visible.length})` : ""}</span>
        {user.role === "admin" ? (
          <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1 text-theme-xs font-medium text-brand-600 hover:underline">
            <Plus size={13} /> Novo campo
          </button>
        ) : (
          visible.length === 0 && <span className="text-theme-xs text-gray-400">Novos campos: peça a um administrador.</span>
        )}
      </div>
      <CustomFieldsForm fields={fields} values={values} onChange={onChange} columns={2} />
      {visible.length === 0 && user.role === "admin" && (
        <p className="text-theme-xs text-gray-400">Nenhum campo ainda. Crie campos como “Cargo”, “Data de nascimento” ou “RG” (tipo Documento, ligado ao GED).</p>
      )}
      {creating && (
        <CustomFieldModal
          field={null}
          defaultEntity={entity}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onFieldsChanged();
          }}
        />
      )}
    </>
  );
}
