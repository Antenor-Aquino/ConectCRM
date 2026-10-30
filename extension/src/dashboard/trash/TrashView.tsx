// Lixeira (spec 11): tudo o que foi excluído, com o prazo para a exclusão
// definitiva. Restaurar traz de volta o registro e o que foi junto; excluir
// definitivamente (administrador) não tem volta.
import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Search, Settings, Trash2 } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel, TaSelect, cn } from "@tailadmin";
import { call, DATA_CHANGED_EVENT, TRASH_EVENT } from "../../rpc/client";
import { ENTITY_LABEL, type TrashItem } from "../../db/trash";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { deleteOrphans } from "../../lib/documentFiles";
import { useSession } from "../session";

type Msg = { text: string; kind: "ok" | "err" } | null;

/** Cartões com financeiro não são apagados da lixeira (o lançamento perderia o vínculo). */
const keptNote = (n: number) =>
  n ? ` ${n === 1 ? "1 cartão ficou" : `${n} cartões ficaram`} na lixeira por ter lançamentos na Gestão Financeira: restaure e arquive.` : "";

const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));

export function TrashView({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { user } = useSession();
  const admin = user.role === "admin";
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [days, setDays] = useState(30);
  const [entity, setEntity] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    const [list, s] = await Promise.all([call("trash.list", { entity: entity || undefined, search: search || undefined }), call("trash.settings")]);
    setItems(list);
    setDays(s.days);
    setSelected((cur) => new Set([...cur].filter((id) => list.some((i) => i.id === id))));
  }, [entity, search]);

  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener(TRASH_EVENT, on);
    window.addEventListener(DATA_CHANGED_EVENT, on);
    return () => {
      window.removeEventListener(TRASH_EVENT, on);
      window.removeEventListener(DATA_CHANGED_EVENT, on);
    };
  }, [load]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ text: await fn(), kind: "ok" });
    } catch (e) {
      setMsg({ text: errorText(e), kind: "err" });
    } finally {
      setBusy(false);
      await load();
    }
  };

  const restore = (ids: string[]) =>
    act(async () => {
      const r = await call("trash.restore", { ids });
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
      if (r.errors.length) {
        const first = items?.find((i) => i.id === r.errors[0]!.id)?.title;
        throw new Error(`${r.restored ? `${r.restored} restaurado(s). ` : ""}Não restaurado${first ? ` “${first}”` : ""}: ${r.errors[0]!.message}`);
      }
      return r.restored === 1 ? "Restaurado." : `${r.restored} itens restaurados.`;
    });

  const purge = (ids: string[]) => {
    if (!confirm(`Excluir definitivamente ${ids.length === 1 ? "este item" : `${ids.length} itens`}? Não será possível recuperar.`)) return;
    void act(async () => {
      const r = await call("trash.purge", { ids });
      await deleteOrphans(r.orphans);
      const kept = keptNote(r.protected);
      if (!r.purged && kept) throw new Error(kept.trim());
      return `${r.purged === 1 ? "Excluído definitivamente." : `${r.purged} itens excluídos definitivamente.`}${kept}`;
    });
  };

  const empty = () => {
    if (!confirm("Esvaziar a lixeira? Todos os itens serão excluídos definitivamente, sem possibilidade de recuperação.")) return;
    void act(async () => {
      const r = await call("trash.empty");
      await deleteOrphans(r.orphans);
      return `Lixeira esvaziada (${r.purged} itens).${keptNote(r.protected)}`;
    });
  };

  const all = items ?? [];
  const allSelected = all.length > 0 && all.every((i) => selected.has(i.id));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <TaPanel
      title="Lixeira"
      subtitle={`O que foi excluído fica aqui por ${days} dia${days === 1 ? "" : "s"} e pode ser restaurado; depois é excluído definitivamente.${admin ? "" : " Você vê o que você mesmo excluiu."}`}
      action={
        <div className="flex items-center gap-2">
          {admin && onOpenSettings && (
            <TaButton size="sm" startIcon={<Settings size={14} />} onClick={onOpenSettings}>
              Prazo
            </TaButton>
          )}
          {admin && (
            <TaButton size="sm" variant="ghost" className="text-error-600" disabled={busy || !all.length} startIcon={<Trash2 size={14} />} onClick={empty}>
              Esvaziar lixeira
            </TaButton>
          )}
        </div>
      }
    >
      <div data-trash-view>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
            <TaInput
              className="pl-9"
              placeholder="Buscar na lixeira"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar na lixeira"
            />
          </div>
          <TaSelect className="w-56" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(ENTITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </TaSelect>
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2" data-trash-bulk>
              <span className="text-theme-sm text-gray-600 dark:text-gray-400">{selected.size} selecionado(s)</span>
              <TaButton size="sm" variant="primary" disabled={busy} startIcon={<RotateCcw size={14} />} onClick={() => void restore([...selected])}>
                Restaurar
              </TaButton>
              {admin && (
                <TaButton size="sm" disabled={busy} startIcon={<Trash2 size={14} />} onClick={() => purge([...selected])}>
                  Excluir definitivamente
                </TaButton>
              )}
            </div>
          )}
        </div>
        {msg && (
          <p
            className={`mb-3 rounded-lg px-3 py-2 text-theme-sm ${msg.kind === "ok" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700"}`}
            data-trash-msg
          >
            {msg.text}
          </p>
        )}
        {items === null ? (
          <p className="text-theme-sm text-gray-500">Carregando…</p>
        ) : all.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 py-12 text-gray-500 dark:border-gray-700">
            <Trash2 size={28} className="text-gray-300" />
            <p className="text-theme-sm">{search || entity ? "Nada encontrado com esses filtros." : "A lixeira está vazia."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-theme-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-theme-xs text-gray-500 dark:border-gray-800">
                  <th className="w-8 py-2">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(all.map((i) => i.id)))}
                    />
                  </th>
                  <th className="py-2 font-medium">Item</th>
                  <th className="py-2 font-medium">Tipo</th>
                  <th className="py-2 font-medium">Excluído por</th>
                  <th className="py-2 font-medium">Excluído em</th>
                  <th className="py-2 font-medium">Exclusão definitiva</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {all.map((i) => {
                  const left = daysLeft(i.expires_at);
                  return (
                    <tr key={i.id} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-trash-item={i.entity}>
                      <td className="py-2.5">
                        <input type="checkbox" aria-label={`Selecionar ${i.title}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                      </td>
                      <td className="max-w-[380px] py-2.5 pr-3">
                        <p className="truncate font-medium text-gray-800 dark:text-white/90">{i.title}</p>
                        {(i.detail || i.related > 0) && (
                          <p className="truncate text-theme-xs text-gray-500">
                            {i.detail}
                            {i.related > 0 && `${i.detail ? " · " : ""}+${i.related} item(ns) junto (atividades, notas…)`}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 text-gray-600 dark:text-gray-400">{ENTITY_LABEL[i.entity] ?? i.entity}</td>
                      <td className="py-2.5 text-gray-600 dark:text-gray-400">{i.deleted_by_name ?? "—"}</td>
                      <td className="whitespace-nowrap py-2.5 text-gray-600 dark:text-gray-400">{formatDateTime(i.deleted_at)}</td>
                      <td className="whitespace-nowrap py-2.5">
                        {i.finance_locked ? (
                          <span title="Tem lançamentos na Gestão Financeira: a lixeira não apaga. Restaure e arquive o cartão.">
                            <TaBadge color="amber" label="Tem financeiro: não é apagado" />
                          </span>
                        ) : (
                          <span title={formatDateTime(i.expires_at)}>
                            <TaBadge
                              color={left <= 3 ? "red" : left <= 7 ? "amber" : "slate"}
                              label={left === 0 ? "hoje" : `em ${left} dia${left === 1 ? "" : "s"}`}
                            />
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2.5 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void restore([i.id])}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-theme-xs font-medium text-brand-600 hover:bg-brand-50"
                        >
                          <RotateCcw size={13} /> Restaurar
                        </button>
                        {admin && (
                          <button
                            type="button"
                            disabled={busy}
                            title="Excluir definitivamente"
                            aria-label={`Excluir definitivamente ${i.title}`}
                            onClick={() => purge([i.id])}
                            className={cn("ml-1 rounded-lg p-1.5 text-gray-400 hover:bg-error-50 hover:text-error-600")}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TaPanel>
  );
}
