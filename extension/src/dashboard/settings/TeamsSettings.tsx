// Configurações → Equipes: definem a visão "Minha equipe" e o que o gestor vê.
import { useEffect, useState } from "react";
import { Crown, Pencil, Plus, Trash2 } from "lucide-react";
import { TaButton, TaInput, TaPanel } from "@tailadmin";
import { GuardedModal } from "../ui/GuardedModal";
import { call } from "../../rpc/client";
import { ROLE_LABEL, type Team } from "../../db/users";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { ErrorText, Field, SectionLabel } from "../ui/form";
import { errorText } from "../../lib/errors";

export function TeamsSettings() {
  const { user: me, users } = useSession();
  const isAdmin = me.role === "admin";
  const [teams, setTeams] = useState<Team[]>([]);
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const load = () => call("teams.list").then(setTeams);
  useEffect(() => {
    void load();
  }, []);
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "(inativo)";

  return (
    <TaPanel
      title="Equipes"
      subtitle="O gestor vê os negócios das equipes de que participa; a visão “Minha equipe” usa estas equipes."
      action={
        isAdmin && (
          <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={() => setEditing("new")}>
            Nova equipe
          </TaButton>
        )
      }
    >
      {teams.length === 0 && <p className="text-theme-sm text-gray-500">Nenhuma equipe cadastrada.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {teams.map((t) => (
          <div key={t.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex-1 font-semibold text-gray-800 dark:text-white/90">{t.name}</span>
              {isAdmin && (
                <>
                  <button type="button" title="Editar" className="text-gray-400 hover:text-brand-600" onClick={() => setEditing(t)}>
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    title="Excluir"
                    className="text-gray-400 hover:text-error-600"
                    onClick={async () => {
                      if (!confirm(`Excluir a equipe "${t.name}"? Vai para a lixeira, de onde pode ser restaurado.`)) return;
                      await call("teams.delete", { id: t.id });
                      await load();
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {t.members.map((m) => (
                <span key={m.userId} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-1 text-theme-xs text-gray-700 dark:bg-white/5 dark:text-gray-300">
                  <Avatar name={name(m.userId)} size={18} />
                  {name(m.userId)}
                  {m.isLeader && <Crown size={12} className="text-warning-500" />}
                </span>
              ))}
              {t.members.length === 0 && <span className="text-theme-xs text-gray-400">Sem membros.</span>}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <TeamModal
          team={editing === "new" ? null : editing}
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

function TeamModal({ team, onClose, onSaved }: { team: Team | null; onClose: () => void; onSaved: () => void }) {
  const { users } = useSession();
  const [name, setName] = useState(team?.name ?? "");
  const [members, setMembers] = useState<Record<string, boolean>>(() => Object.fromEntries((team?.members ?? []).map((m) => [m.userId, m.isLeader])));
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const list = Object.entries(members).map(([userId, isLeader]) => ({ userId, isLeader }));
    try {
      if (team) {
        await call("teams.rename", { id: team.id, name });
        await call("teams.setMembers", { id: team.id, members: list });
      } else await call("teams.create", { name, members: list });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <GuardedModal isOpen onClose={onClose} title={team ? "Editar equipe" : "Nova equipe"}>
      <Field label="Nome da equipe" required>
        <TaInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Comercial SP" />
      </Field>
      <SectionLabel>Membros</SectionLabel>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {users.map((u) => {
          const inTeam = u.id in members;
          return (
            <div key={u.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5">
              <input
                type="checkbox"
                checked={inTeam}
                onChange={(e) =>
                  setMembers((m) => {
                    const c = { ...m };
                    if (e.target.checked) c[u.id] = false;
                    else delete c[u.id];
                    return c;
                  })
                }
              />
              <Avatar name={u.name} size={22} />
              <span className="flex-1 text-theme-sm text-gray-700 dark:text-gray-300">
                {u.name} <span className="text-theme-xs text-gray-400">({ROLE_LABEL[u.role]})</span>
              </span>
              {inTeam && (
                <label className="flex items-center gap-1 text-theme-xs text-gray-500">
                  <input type="checkbox" checked={members[u.id]} onChange={(e) => setMembers((m) => ({ ...m, [u.id]: e.target.checked }))} /> Líder
                </label>
              )}
            </div>
          );
        })}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-5 flex justify-end gap-2">
        <TaButton onClick={onClose}>Cancelar</TaButton>
        <TaButton variant="primary" onClick={() => void save()}>
          Salvar
        </TaButton>
      </div>
    </GuardedModal>
  );
}
