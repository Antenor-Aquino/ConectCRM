// Usuário atual no topo, com troca de usuário (o PIN de cada usuário entra na Fase 3).
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@tailadmin";
import { ROLE_LABEL } from "../../db/users";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { Popover } from "../ui/Popover";

export function UserSwitcher() {
  const { user, users, switchUser } = useSession();
  const [open, setOpen] = useState(false);
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
      <Popover open={open} onClose={() => setOpen(false)} className="left-auto right-0 min-w-[220px] py-1">
        <p className="px-3.5 py-1.5 text-theme-xs font-semibold uppercase text-gray-400">Trocar usuário</p>
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => {
              setOpen(false);
              void switchUser(u.id);
            }}
            className={cn("flex w-full items-center gap-2 px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5", u.id === user.id ? "font-medium text-brand-600" : "text-gray-700 dark:text-gray-300")}
          >
            <Avatar name={u.name} size={22} />
            {u.name} <span className="text-theme-xs text-gray-400">({ROLE_LABEL[u.role]})</span>
          </button>
        ))}
      </Popover>
    </div>
  );
}
