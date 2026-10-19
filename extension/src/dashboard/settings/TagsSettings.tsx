// Configurações → Tags: separadas por entidade (spec 01, seção 8).
import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { TaButton, TaInput, TaPanel, badgePalette, cn, type BadgeColor } from "@tailadmin";
import { call } from "../../rpc/client";
import { TAG_ENTITIES, type Tag, type TagEntity } from "../../db/tags";
import { useSession } from "../session";
import { Switch } from "../ui/Switch";
import { TagChip } from "../ui/TagPicker";
import { colorLabel } from "../../lib/colors";
import { errorText } from "../../lib/errors";

const ENTITY_LABEL: Record<TagEntity, string> = {
  person: "Contato",
  organization: "Organização",
  deal: "Negócio",
  ticket: "Ticket",
  project: "Projeto",
  activity: "Atividade",
  document: "Documento",
};
const COLORS = Object.keys(badgePalette) as BadgeColor[];

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: BadgeColor) => void }) {
  return (
    <span className="flex gap-1">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          title={colorLabel(c)}
          onClick={() => onChange(c)}
          className={cn("h-6 w-6 rounded-full border-2", value === c ? "border-gray-800 dark:border-white" : "border-transparent")}
          style={{ background: badgePalette[c].fg }}
        />
      ))}
    </span>
  );
}

export function TagsSettings() {
  const { user } = useSession();
  const isAdmin = user.role === "admin";
  const [entity, setEntity] = useState<TagEntity>("person");
  const [tags, setTags] = useState<Tag[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<BadgeColor>("blue");
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTags(await call("tags.list", { entity, includeInactive: true }));
    setUsage(await call("tags.usage", { entity }));
  }, [entity]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <TaPanel title="Tags" subtitle="Cada tipo de cadastro tem suas próprias tags.">
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
        {TAG_ENTITIES.map((en) => (
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

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-gray-300 p-3 dark:border-gray-700">
        <TaInput className="w-56" placeholder={`Nova tag de ${ENTITY_LABEL[entity].toLowerCase()}`} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <ColorPicker value={newColor} onChange={setNewColor} />
        <TaButton
          variant="primary"
          startIcon={<Plus size={15} />}
          disabled={!newName.trim()}
          onClick={() =>
            void run(async () => {
              await call("tags.create", { entity, name: newName, color: newColor });
              setNewName("");
            })
          }
        >
          Adicionar
        </TaButton>
      </div>
      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}

      {tags.length === 0 ? (
        <p className="py-6 text-center text-theme-sm text-gray-500">Nenhuma tag de {ENTITY_LABEL[entity].toLowerCase()}.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {tags.map((t) => (
            <li key={t.id} className={cn("flex flex-wrap items-center gap-3 py-2.5", !t.active && "opacity-50")}>
              {editing?.id === t.id ? (
                <>
                  <TaInput className="w-56" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                  <button type="button" title="Salvar" className="text-success-600" onClick={() => void run(async () => {
                    await call("tags.update", { id: t.id, patch: { name: editing.name, color: editing.color } });
                    setEditing(null);
                  })}>
                    <Check size={18} />
                  </button>
                  <button type="button" title="Cancelar" className="text-gray-400" onClick={() => setEditing(null)}>
                    <X size={18} />
                  </button>
                </>
              ) : (
                <>
                  <TagChip tag={t} />
                  <span className="text-theme-xs text-gray-500">{usage[t.id] ?? 0} uso(s)</span>
                  {isAdmin && (
                    <span className="ml-auto flex items-center gap-3 text-gray-400">
                      <span className="flex items-center gap-1.5 text-theme-xs">
                        Ativa <Switch checked={!!t.active} onChange={(v) => void run(() => call("tags.update", { id: t.id, patch: { active: v } }))} />
                      </span>
                      <button type="button" title="Editar" className="hover:text-brand-600" onClick={() => setEditing({ id: t.id, name: t.name, color: t.color })}>
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        title="Excluir"
                        className="hover:text-error-600"
                        onClick={() => {
                          const n = usage[t.id] ?? 0;
                          if (confirm(n ? `A tag "${t.name}" está em ${n} registro(s) e será removida deles. Excluir? Vai para a lixeira, de onde pode ser restaurado.` : `Excluir a tag "${t.name}"? Vai para a lixeira, de onde pode ser restaurado.`)) {
                            void run(() => call("tags.delete", { id: t.id }));
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!isAdmin && <p className="mt-3 text-theme-xs text-gray-500">Qualquer usuário cria tags; editar e excluir é só para administradores.</p>}
    </TaPanel>
  );
}
