// Tela de bloqueio: usuário com PIN ao abrir o CRM. Permite entrar como outro usuário.
import { Lock } from "lucide-react";
import { TaSelect } from "@tailadmin";
import { ROLE_LABEL, type User } from "../../db/users";
import { Avatar } from "../ui/Avatar";
import { PinCheck } from "./PinInput";

export function LockScreen({
  user,
  users,
  onUnlock,
  onSwitch,
}: {
  user: User;
  users: User[];
  onUnlock: (id: string) => void;
  onSwitch: (id: string) => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-theme-md dark:border-gray-800 dark:bg-gray-900">
        <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white">
          <Lock size={18} />
        </span>
        <h1 className="mb-1 text-theme-xl font-semibold text-gray-800 dark:text-white/90">ConectCRM bloqueado</h1>
        <div className="mb-5 mt-3 flex items-center justify-center gap-2">
          <Avatar name={user.name} size={28} />
          <TaSelect className="w-auto" value={user.id} onChange={(e) => onSwitch(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({ROLE_LABEL[u.role]})
              </option>
            ))}
          </TaSelect>
        </div>
        <PinCheck key={user.id} userId={user.id} onOk={() => onUnlock(user.id)} />
      </div>
    </div>
  );
}
