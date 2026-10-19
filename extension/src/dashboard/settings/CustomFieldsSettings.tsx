// Configurações → Campos personalizados: por entidade, com categorias
// (grupos nos formulários), ordem, chave, marcações (sempre mostrar /
// esconder / obrigatório) e funis.
import { Fragment, useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { TaBadge, TaButton, TaPanel, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPE_LABEL, type CustomField, type CustomFieldEntity, type CustomFieldGroup } from "../../db/customFields";
import type { Pipeline } from "../../db/pipelines";
import { useSession } from "../session";
import { CustomFieldModal, ENTITY_LABEL } from "./CustomFieldModal";
import { errorText } from "../../lib/errors";

const NO_GROUP = "";

export function CustomFieldsSettings() {
  const { user } = useSession();
  const isAdmin = user.role === "admin";
  const [entity, setEntity] = useState<CustomFieldEntity>("person");
  const [fields, setFields] = useState<CustomField[]>([]);
  const [groups, setGroups] = useState<CustomFieldGroup[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [editing, setEditing] = useState<{ field: CustomField | null; groupId?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([call("customFields.list", { entity, includeInactive: true }), call("fieldGroups.list", { entity })]).then(([f, g]) => {
        setFields(f);
        setGroups(g);
      }),
    [entity],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void call("pipelines.list", { includeArchived: true }).then(setPipelines);
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  // Seções na ordem da tela: sem categoria primeiro, depois as categorias.
  const sections: { group: CustomFieldGroup | null; fields: CustomField[] }[] = [
    { group: null, fields: fields.filter((f) => !f.group_id || !groups.some((g) => g.id === f.group_id)) },
    ...groups.map((g) => ({ group: g, fields: fields.filter((f) => f.group_id === g.id) })),
  ];
  const ordered = sections.flatMap((s) => s.fields);

  /** Sobe/desce dentro da categoria. */
  const move = (f: CustomField, dir: -1 | 1) =>
    act(async () => {
      const sec = sections.find((s) => s.fields.includes(f))!.fields;
      const i = sec.indexOf(f);
      const other = sec[i + dir];
      if (!other) return;
      const ids = ordered.map((x) => x.id);
      const a = ids.indexOf(f.id);
      const b = ids.indexOf(other.id);
      [ids[a], ids[b]] = [ids[b]!, ids[a]!];
      await call("customFields.reorder", { ids });
    });

  const moveGroup = (i: number, dir: -1 | 1) =>
    act(async () => {
      const ids = groups.map((g) => g.id);
      const j = i + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      await call("fieldGroups.reorder", { ids });
    });

  const newGroup = () => {
    const name = prompt(`Nome da nova categoria de ${ENTITY_LABEL[entity].toLowerCase()} (ex.: Dados profissionais):`)?.trim();
    if (name) void act(() => call("fieldGroups.create", { entity, name }));
  };
  const renameGroup = (g: CustomFieldGroup) => {
    const name = prompt("Novo nome da categoria:", g.name)?.trim();
    if (name && name !== g.name) void act(() => call("fieldGroups.rename", { id: g.id, name }));
  };
  const removeGroup = (g: CustomFieldGroup) => {
    if (!confirm(`Excluir a categoria "${g.name}"?${g.field_count ? ` Os ${g.field_count} campo(s) dela continuam, sem categoria.` : ""} Vai para a lixeira, de onde pode ser restaurado.`)) return;
    void act(() => call("fieldGroups.delete", { id: g.id }));
  };

  const remove = async (f: CustomField) => {
    const used = await call("customFields.usage", { id: f.id });
    const msg = used
      ? `O campo "${f.name}" tem valor em ${used} registro(s). Excluir mesmo assim? Os valores deixam de aparecer. Vai para a lixeira, de onde pode ser restaurado.`
      : `Excluir o campo "${f.name}"? Vai para a lixeira, de onde pode ser restaurado.`;
    if (!confirm(msg)) return;
    void act(() => call("customFields.delete", { id: f.id }));
  };

  const iconBtn = "flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5";

  return (
    <TaPanel
      title="Campos personalizados"
      subtitle="Campos extras para cada tipo de cadastro, organizados em categorias. A chave {{…}} pode ser usada nas mensagens do chat."
      action={
        isAdmin && (
          <span className="flex gap-2">
            <TaButton startIcon={<FolderPlus size={15} />} onClick={newGroup}>
              Nova categoria
            </TaButton>
            <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={() => setEditing({ field: null })}>
              Novo campo
            </TaButton>
          </span>
        )
      }
    >
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
        {CUSTOM_FIELD_ENTITIES.map((en) => (
          <button
            key={en}
            type="button"
            onClick={() => setEntity(en)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-theme-sm font-medium",
              entity === en ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-900" : "text-gray-600 dark:text-gray-400",
            )}
          >
            {ENTITY_LABEL[en]}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      {fields.length === 0 && groups.length === 0 ? (
        <p className="py-6 text-center text-theme-sm text-gray-500">Nenhum campo personalizado em {ENTITY_LABEL[entity]}.</p>
      ) : (
        <table className="w-full text-left text-theme-sm">
          <thead className="text-theme-xs uppercase text-gray-500">
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="w-14 py-2" />
              <th className="py-2 pr-3 font-medium">Nome</th>
              <th className="py-2 pr-3 font-medium">Tipo</th>
              <th className="py-2 pr-3 font-medium">Chave</th>
              <th className="py-2 pr-3 font-medium">Categoria</th>
              <th className="py-2 pr-3 font-medium">Marcações</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sections.map(({ group, fields: list }) =>
              // Sem categorias, a lista é uma só (sem cabeçalho).
              !group && groups.length === 0 ? (
                <Fragment key="geral">{list.map((f) => row(f, list))}</Fragment>
              ) : (
                <Fragment key={group?.id ?? "geral"}>
                  {(group || list.length > 0) && (
                    <tr className="bg-gray-50 dark:bg-white/[0.03]" data-field-group={group?.name ?? "Sem categoria"}>
                      <td className="py-2 pl-1">
                        {group && isAdmin && (
                          <span className="flex">
                            <button type="button" title="Subir categoria" className={iconBtn} onClick={() => void moveGroup(groups.indexOf(group), -1)}>
                              <ArrowUp size={13} />
                            </button>
                            <button type="button" title="Descer categoria" className={iconBtn} onClick={() => void moveGroup(groups.indexOf(group), 1)}>
                              <ArrowDown size={13} />
                            </button>
                          </span>
                        )}
                      </td>
                      <td colSpan={5} className="py-2 pr-3 text-theme-xs font-semibold uppercase tracking-wide text-gray-500">
                        {group ? group.name : "Sem categoria"} <span className="font-normal">({list.length})</span>
                      </td>
                      <td className="py-2 text-right">
                        {group && isAdmin && (
                          <span className="flex justify-end gap-1">
                            <button
                              type="button"
                              title="Novo campo nesta categoria"
                              className={iconBtn}
                              onClick={() => setEditing({ field: null, groupId: group.id })}
                            >
                              <Plus size={14} />
                            </button>
                            <button type="button" title="Renomear categoria" className={iconBtn} onClick={() => renameGroup(group)}>
                              <Pencil size={13} />
                            </button>
                            <button type="button" title="Excluir categoria" className={cn(iconBtn, "hover:text-error-600")} onClick={() => removeGroup(group)}>
                              <Trash2 size={13} />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                  {group && list.length === 0 && (
                    <tr>
                      <td />
                      <td colSpan={6} className="py-2 text-theme-xs text-gray-400">
                        Nenhum campo nesta categoria. Use o + ao lado do nome ou escolha a categoria ao editar um campo.
                      </td>
                    </tr>
                  )}
                  {list.map((f) => row(f, list))}
                </Fragment>
              ),
            )}
          </tbody>
        </table>
      )}
      {!isAdmin && <p className="mt-3 text-theme-xs text-gray-500">Só administradores criam e alteram campos personalizados.</p>}
      {editing && (
        <CustomFieldModal
          field={editing.field}
          defaultEntity={entity}
          defaultGroupId={editing.groupId}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </TaPanel>
  );

  function row(f: CustomField, list: CustomField[]) {
    const i = list.indexOf(f);
    return (
      <tr key={f.id} className={cn("border-b border-gray-100 dark:border-gray-800", !f.active && "opacity-50")} data-field={f.name}>
        <td className="py-2.5">
          {isAdmin && (
            <span className="flex">
              <button type="button" title="Subir" disabled={i === 0} className={cn(iconBtn, "disabled:opacity-30")} onClick={() => void move(f, -1)}>
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                title="Descer"
                disabled={i === list.length - 1}
                className={cn(iconBtn, "disabled:opacity-30")}
                onClick={() => void move(f, 1)}
              >
                <ArrowDown size={14} />
              </button>
            </span>
          )}
        </td>
        <td className="py-2.5 pr-3">
          <span className="font-medium text-gray-800 dark:text-white/90">{f.name}</span>
          {f.description && <span className="block text-theme-xs text-gray-500">{f.description}</span>}
          {f.pipelineIds.length > 0 && (
            <span className="block text-theme-xs text-gray-400">
              Só em:{" "}
              {f.pipelineIds
                .map((id) => pipelines.find((p) => p.id === id)?.name)
                .filter(Boolean)
                .join(", ")}
            </span>
          )}
        </td>
        <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400">
          {CUSTOM_FIELD_TYPE_LABEL[f.field_type]}
          {f.options.length > 0 && <span className="block text-theme-xs text-gray-400">{f.options.map((o) => o.label).join(", ")}</span>}
        </td>
        <td className="py-2.5 pr-3 font-mono text-theme-xs text-brand-600">{`{{${f.placeholder_key}}}`}</td>
        <td className="py-2.5 pr-3">
          {isAdmin && groups.length > 0 ? (
            <TaSelect
              value={f.group_id ?? NO_GROUP}
              onChange={(e) => void act(() => call("customFields.update", { id: f.id, patch: { groupId: e.target.value || null } }))}
              className="h-8 min-w-[150px] py-0 text-theme-xs"
              aria-label={`Categoria de ${f.name}`}
            >
              <option value={NO_GROUP}>Sem categoria</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </TaSelect>
          ) : (
            <span className="text-theme-xs text-gray-500">{f.group_name ?? "—"}</span>
          )}
        </td>
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
              <button type="button" title="Editar" className="hover:text-brand-600" onClick={() => setEditing({ field: f })}>
                <Pencil size={15} />
              </button>
              <button type="button" title="Excluir" className="hover:text-error-600" onClick={() => void remove(f)}>
                <Trash2 size={15} />
              </button>
            </span>
          )}
        </td>
      </tr>
    );
  }
}
