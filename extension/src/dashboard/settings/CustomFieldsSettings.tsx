// Configurações → Campos personalizados: por entidade, com ordem, chave,
// marcações (sempre mostrar / esconder / obrigatório) e funis.
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { TaBadge, TaButton, TaPanel, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPE_LABEL, type CustomField, type CustomFieldEntity } from "../../db/customFields";
import type { Pipeline } from "../../db/pipelines";
import { useSession } from "../session";
import { CustomFieldModal, ENTITY_LABEL } from "./CustomFieldModal";
import { errorText } from "../../lib/errors";

export function CustomFieldsSettings() {
  const { user } = useSession();
  const isAdmin = user.role === "admin";
  const [entity, setEntity] = useState<CustomFieldEntity>("person");
  const [fields, setFields] = useState<CustomField[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [editing, setEditing] = useState<CustomField | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => call("customFields.list", { entity, includeInactive: true }).then(setFields), [entity]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void call("pipelines.list", { includeArchived: true }).then(setPipelines);
  }, []);

  const move = async (i: number, dir: -1 | 1) => {
    const ids = fields.map((f) => f.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await call("customFields.reorder", { ids });
    await load();
  };

  const remove = async (f: CustomField) => {
    const used = await call("customFields.usage", { id: f.id });
    const msg = used ? `O campo "${f.name}" tem valor em ${used} registro(s). Excluir mesmo assim? Os valores deixam de aparecer.` : `Excluir o campo "${f.name}"?`;
    if (!confirm(msg)) return;
    try {
      await call("customFields.delete", { id: f.id });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <TaPanel
      title="Campos personalizados"
      subtitle="Campos extras para cada tipo de cadastro. A chave {{…}} pode ser usada nas mensagens do chat."
      action={
        isAdmin && (
          <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={() => setEditing("new")}>
            Novo campo
          </TaButton>
        )
      }
    >
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
        {CUSTOM_FIELD_ENTITIES.map((en) => (
          <button
            key={en}
            type="button"
            onClick={() => setEntity(en)}
            className={cn("flex-1 rounded-md px-3 py-1.5 text-theme-sm font-medium", entity === en ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-900" : "text-gray-600 dark:text-gray-400")}
          >
            {ENTITY_LABEL[en]}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      {fields.length === 0 ? (
        <p className="py-6 text-center text-theme-sm text-gray-500">Nenhum campo personalizado em {ENTITY_LABEL[entity]}.</p>
      ) : (
        <table className="w-full text-left text-theme-sm">
          <thead className="text-theme-xs uppercase text-gray-500">
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="w-14 py-2" />
              <th className="py-2 pr-3 font-medium">Nome</th>
              <th className="py-2 pr-3 font-medium">Tipo</th>
              <th className="py-2 pr-3 font-medium">Chave</th>
              <th className="py-2 pr-3 font-medium">Marcações</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={f.id} className={cn("border-b border-gray-100 dark:border-gray-800", !f.active && "opacity-50")}>
                <td className="py-2.5">
                  {isAdmin && (
                    <span className="flex gap-1 text-gray-400">
                      <button type="button" title="Subir" onClick={() => void move(i, -1)}><ArrowUp size={14} /></button>
                      <button type="button" title="Descer" onClick={() => void move(i, 1)}><ArrowDown size={14} /></button>
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <span className="font-medium text-gray-800 dark:text-white/90">{f.name}</span>
                  {f.description && <span className="block text-theme-xs text-gray-500">{f.description}</span>}
                  {f.pipelineIds.length > 0 && (
                    <span className="block text-theme-xs text-gray-400">
                      Só em: {f.pipelineIds.map((id) => pipelines.find((p) => p.id === id)?.name).filter(Boolean).join(", ")}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400">
                  {CUSTOM_FIELD_TYPE_LABEL[f.field_type]}
                  {f.options.length > 0 && <span className="block text-theme-xs text-gray-400">{f.options.map((o) => o.label).join(", ")}</span>}
                </td>
                <td className="py-2.5 pr-3 font-mono text-theme-xs text-brand-600">{`{{${f.placeholder_key}}}`}</td>
                <td className="py-2.5 pr-3">
                  <span className="flex flex-wrap gap-1">
                    {!!f.always_show && <TaBadge color="blue" label="Sempre mostrar" />}
                    {!!f.hidden && <TaBadge color="slate" label="Escondido" />}
                    {!!f.required && <TaBadge color="red" label="Obrigatório" />}
                    {!f.active && <TaBadge color="amber" label="Inativo" />}
                  </span>
                </td>
                <td className="py-2.5 text-right">
                  {isAdmin && (
                    <span className="flex justify-end gap-2 text-gray-400">
                      <button type="button" title="Editar" className="hover:text-brand-600" onClick={() => setEditing(f)}>
                        <Pencil size={15} />
                      </button>
                      <button type="button" title="Excluir" className="hover:text-error-600" onClick={() => void remove(f)}>
                        <Trash2 size={15} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!isAdmin && <p className="mt-3 text-theme-xs text-gray-500">Só administradores criam e alteram campos personalizados.</p>}
      {editing && (
        <CustomFieldModal
          field={editing === "new" ? null : editing}
          defaultEntity={entity}
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
