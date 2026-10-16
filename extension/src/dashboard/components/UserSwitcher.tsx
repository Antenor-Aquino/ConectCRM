// Usuário atual no topo: troca de usuário (pede o PIN de quem tiver) e bloqueio.
import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { TaModal, cn } from "@tailadmin";
import { ROLE_LABEL, type User } from "../../db/users";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { Popover } from "../ui/Popover";
import { PinCheck } from "./PinInput";

export function UserSwitcher() {
  const { user, users, switchUser, unlock, lock } = useSession();
  const [open, setOpen] = useState(false);
  const [askPin, setAskPin] = useState<User | null>(null);

  const choose = async (u: User) => {
    setOpen(false);
    if (u.id === user.id) return;
    if (u.has_pin) setAskPin(u);
    else await switchUser(u.id);
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-gray-100 dark:hover:bg-white/5" title="Trocar usuário">
        <Avatar name={user.name} size={28} />
        <span className="hidden text-left md:block">
          <span className="block text-theme-xs font-medium leading-tight text-gray-800 dark:text-white/90">{user.name}</span>
          <span className="block text-[10px] leading-tight text-gray-500">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="left-auto right-0 min-w-[230px] py-1">
        <p className="px-3.5 py-1.5 text-theme-xs font-semibold uppercase text-gray-400">Trocar usuário</p>
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => void choose(u)}
            className={cn("flex w-full items-center gap-2 px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5", u.id === user.id ? "font-medium text-brand-600" : "text-gray-700 dark:text-gray-300")}
          >
            <Avatar name={u.name} size={22} />
            <span className="flex-1">
              {u.name} <span className="text-theme-xs text-gray-400">({ROLE_LABEL[u.role]})</span>
            </span>
            {!!u.has_pin && <Lock size={12} className="text-gray-400" />}
          </button>
        ))}
        {!!user.has_pin && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void lock();
            }}
            className="mt-1 flex w-full items-center gap-2 border-t border-gray-100 px-3.5 py-2.5 text-left text-theme-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300"
          >
            <Lock size={15} /> Bloquear agora
          </button>
        )}
      </Popover>
      {askPin && (
        <TaModal isOpen onClose={() => setAskPin(null)} title={`Entrar como ${askPin.name}`} width="max-w-sm">
          <PinCheck
            userId={askPin.id}
            onOk={async () => {
              await unlock(askPin.id);
              await switchUser(askPin.id);
              setAskPin(null);
            }}
          />
        </TaModal>
      )}
    </div>
  );
}
