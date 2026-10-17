// Configurações → Motivos de perda (usados ao marcar um cartão como perdido,
// não resolvido ou não concluído).
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { TaButton, TaInput, TaPanel, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { useSession } from "../session";
import { Switch } from "../ui/Switch";

export function LossReasonsSettings() {
  const { user } = useSession();
  const canEdit = user.role === "admin" || user.role === "gestor";
  const [reasons, setReasons] = useState<{ id: string; name: string; active: number }[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => call("lossReasons.list", { includeInactive: true }).then(setReasons), []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <TaPanel title="Motivos de perda" subtitle="Aparecem ao marcar um negócio como perdido, um ticket como não resolvido ou uma etapa de projeto como não concluída, e nos relatórios.">
      <div className="mb-4 flex max-w-md gap-2">
        <TaInput placeholder="Novo motivo (ex.: Preço)" value={name} onChange={(e) => setName(e.target.value)} />
        <TaButton variant="primary" startIcon={<Plus size={15} />} disabled={!name.trim()} onClick={() => void run(async () => {
          await call("lossReasons.create", { name });
          setName("");
        })}>
          Adicionar
        </TaButton>
      </div>
      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {reasons.map((r) => (
          <li key={r.id} className={cn("flex items-center gap-3 py-2", !r.active && "opacity-50")}>
            <TaInput
              className="max-w-md"
              defaultValue={r.name}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== r.name && void run(() => call("lossReasons.update", { id: r.id, patch: { name: e.target.value } }))}
            />
            {canEdit && (
              <span className="flex items-center gap-1.5 text-theme-xs text-gray-500">
                Ativo <Switch checked={!!r.active} onChange={(v) => void run(() => call("lossReasons.update", { id: r.id, patch: { active: v } }))} />
              </span>
            )}
          </li>
        ))}
        {reasons.length === 0 && <p className="py-4 text-theme-sm text-gray-400">Nenhum motivo cadastrado.</p>}
      </ul>
    </TaPanel>
  );
}
