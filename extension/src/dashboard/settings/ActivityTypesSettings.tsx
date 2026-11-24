// Configurações → Tipos de tarefa: nome, ícone, se é reunião (pode criar
// evento na agenda), ordem e ativo.
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { DragHandle, moveKey, useDragSort } from "../ui/dragSort";
import { TaButton, TaInput, TaPanel, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { ActivityType } from "../../db/activities";
import { ACTIVITY_ICONS, ActivityIcon } from "../../lib/activityIcons";
import { useSession } from "../session";
import { Popover } from "../ui/Popover";
import { Switch } from "../ui/Switch";
import { errorText } from "../../lib/errors";

function IconPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-brand-500 dark:border-gray-700">
        <ActivityIcon name={value} size={18} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="grid w-56 grid-cols-7 gap-1 p-2">
        {Object.keys(ACTIVITY_ICONS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              onChange(name);
              setOpen(false);
            }}
            className={cn("flex h-7 w-7 items-center justify-center rounded text-brand-500 hover:bg-brand-50", name === value && "bg-brand-100")}
          >
            <ActivityIcon name={name} />
          </button>
        ))}
      </Popover>
    </div>
  );
}

export function ActivityTypesSettings() {
  const { user } = useSession();
  const canEdit = user.role === "admin" || user.role === "gestor";
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("circle-check");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => call("activityTypes.list", { includeInactive: true }).then(setTypes), []);
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
  /** Arrastar e soltar: grava a posição de cada tipo que mudou de lugar. */
  const drag = useDragSort({
    onMove: (from, to) => {
      const ids = moveKey(
        types.map((t) => t.id),
        from,
        to,
      );
      void run(async () => {
        for (const [pos, id] of ids.entries()) if (types[pos]?.id !== id) await call("activityTypes.update", { id, patch: { position: pos } });
      });
    },
  });

  return (
    <TaPanel title="Tipos de atividade" subtitle="Tipos marcados como reunião podem criar o evento no Google Agenda ou Outlook.">
      {canEdit && (
        <div className="mb-4 flex max-w-lg items-center gap-2">
          <IconPicker value={icon} onChange={setIcon} />
          <TaInput placeholder="Novo tipo (ex.: Visita)" value={name} onChange={(e) => setName(e.target.value)} />
          <TaButton variant="primary" startIcon={<Plus size={15} />} disabled={!name.trim()} onClick={() => void run(async () => {
            await call("activityTypes.create", { name, icon });
            setName("");
          })}>
            Adicionar
          </TaButton>
        </div>
      )}
      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {types.map((t, i) => {
          const rp = canEdit ? drag.rowProps(t.id) : null;
          return (
          <li key={t.id} {...(rp ?? {})} className={cn("flex flex-wrap items-center gap-3 py-2", !t.active && "opacity-50", rp?.className)}>
            {canEdit && <DragHandle {...drag.handleProps(t.id, types[i - 1]?.id, types[i + 1]?.id)} />}
            <IconPicker value={t.icon} disabled={!canEdit} onChange={(v) => void run(() => call("activityTypes.update", { id: t.id, patch: { icon: v } }))} />
            <TaInput className="max-w-xs" defaultValue={t.name} disabled={!canEdit} onBlur={(e) => e.target.value !== t.name && void run(() => call("activityTypes.update", { id: t.id, patch: { name: e.target.value } }))} />
            <span className="flex items-center gap-1.5 text-theme-xs text-gray-500">
              Reunião <Switch checked={!!t.is_meeting} disabled={!canEdit} onChange={(v) => void run(() => call("activityTypes.update", { id: t.id, patch: { isMeeting: v } }))} />
            </span>
            <span className="flex items-center gap-1.5 text-theme-xs text-gray-500">
              Ativo <Switch checked={!!t.active} disabled={!canEdit} onChange={(v) => void run(() => call("activityTypes.update", { id: t.id, patch: { active: v } }))} />
            </span>
          </li>
          );
        })}
      </ul>
    </TaPanel>
  );
}
