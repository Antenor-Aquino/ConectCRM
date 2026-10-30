// Configurações → Usuários: administradores cadastram e editam; cada usuário
// pode alterar o próprio nome, e-mail e PIN.
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaPanel, TaSelect, cn } from "@tailadmin";
import { GuardedModal } from "../ui/GuardedModal";
import { call } from "../../rpc/client";
import { ROLE_LABEL, type Role, type User } from "../../db/users";
import { isValidPin } from "../../lib/pin";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { ErrorText, Field, SectionLabel } from "../ui/form";
import { errorText } from "../../lib/errors";

const ROLE_BADGE: Record<Role, "blue" | "purple" | "slate"> = { admin: "blue", gestor: "purple", vendedor: "slate" };
const ROLE_HELP: Record<Role, string> = {
  admin: "Vê e edita tudo, cadastra usuários e equipes.",
  gestor: "Vê e edita os negócios da(s) sua(s) equipe(s).",
  vendedor: "Vê e edita só os próprios negócios.",
};

export function UsersSettings() {
  const { user: me, users: activeUsers, reloadUsers } = useSession();
  const isAdmin = me.role === "admin";
  const [all, setAll] = useState<User[] | null>(null);
  const [editing, setEditing] = useState<User | "new" | null>(null);

  const load = useCallback(async () => {
    setAll(await call("users.list", { includeInactive: true }));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const list = all ?? activeUsers;

  return (
    <TaPanel
      title="Usuários"
      subtitle="Administradores, gestores e vendedores desta instalação."
      action={
        isAdmin && (
          <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={() => setEditing("new")}>
            Novo usuário
          </TaButton>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-theme-sm">
          <thead className="text-theme-xs uppercase text-gray-500">
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="py-2 pr-3 font-medium">Nome</th>
              <th className="py-2 pr-3 font-medium">E-mail</th>
              <th className="py-2 pr-3 font-medium">Tipo</th>
              <th className="py-2 pr-3 font-medium">PIN</th>
              <th className="py-2 pr-3 font-medium">Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className={cn("border-b border-gray-100 dark:border-gray-800", !u.active && "opacity-50")}>
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2 text-gray-800 dark:text-white/90">
                    <Avatar name={u.name} size={26} />
                    {u.name}
                    {u.id === me.id && <span className="text-theme-xs text-gray-400">(você)</span>}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400">{u.email ?? "—"}</td>
                <td className="py-2.5 pr-3">
                  <TaBadge color={ROLE_BADGE[u.role]} label={ROLE_LABEL[u.role]} />
                </td>
                <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400">{u.has_pin ? "Definido" : "—"}</td>
                <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400">{u.active ? "Ativo" : "Inativo"}</td>
                <td className="py-2.5 text-right">
                  {(isAdmin || u.id === me.id) && (
                    <button type="button" title="Editar" className="text-gray-400 hover:text-brand-600" onClick={() => setEditing(u)}>
                      <Pencil size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <UserModal
          target={editing === "new" ? null : editing}
          isAdmin={isAdmin}
          isSelf={editing !== "new" && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            await reloadUsers();
          }}
        />
      )}
    </TaPanel>
  );
}

export function UserModal({
  target,
  isAdmin,
  isSelf,
  onClose,
  onSaved,
}: {
  target: User | null;
  isAdmin: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(target?.name ?? "");
  const [email, setEmail] = useState(target?.email ?? "");
  const [role, setRole] = useState<Role>(target?.role ?? "vendedor");
  const [active, setActive] = useState(target ? !!target.active : true);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [removePin, setRemovePin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (pin && (!isValidPin(pin) || pin !== pin2)) {
      setError(!isValidPin(pin) ? "O PIN deve ter de 4 a 6 números." : "A confirmação do PIN não confere.");
      return;
    }
    try {
      let id = target?.id;
      if (!id) id = await call("users.create", { name, email: email || null, role });
      else {
        const patch: Record<string, unknown> = { name, email: email || null };
        if (isAdmin) Object.assign(patch, { role, active });
        await call("users.update", { id, patch });
      }
      if (pin) await call("users.setPin", { id, pin });
      else if (removePin) await call("users.setPin", { id, pin: null });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <GuardedModal isOpen onClose={onClose} title={target ? "Editar usuário" : "Novo usuário"}>
      <Field label="Nome" required>
        <TaInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="E-mail">
        <TaInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com.br" />
      </Field>
      <Field label="Tipo de usuário" hint={ROLE_HELP[role]}>
        <TaSelect value={role} disabled={!isAdmin} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r][0]!.toUpperCase() + ROLE_LABEL[r].slice(1)}
            </option>
          ))}
        </TaSelect>
      </Field>
      {isAdmin && target && !isSelf && (
        <label className="mb-3 flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Usuário ativo
        </label>
      )}

      <SectionLabel>
        <span className="inline-flex items-center gap-1.5">
          <KeyRound size={13} /> PIN de acesso
        </span>
      </SectionLabel>
      <p className="mb-2 text-theme-xs text-gray-500">
        Opcional. Com PIN, o CRM pede a senha numérica (4 a 6 números) ao abrir e ao trocar para este usuário.
        {target?.has_pin ? " Este usuário já tem PIN — preencha para trocar." : ""}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <TaInput type="password" inputMode="numeric" maxLength={6} placeholder="Novo PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        <TaInput type="password" inputMode="numeric" maxLength={6} placeholder="Confirmar PIN" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} />
      </div>
      {target?.has_pin ? (
        <label className="mt-2 flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={removePin} disabled={!!pin} onChange={(e) => setRemovePin(e.target.checked)} /> Remover o PIN
        </label>
      ) : null}

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
