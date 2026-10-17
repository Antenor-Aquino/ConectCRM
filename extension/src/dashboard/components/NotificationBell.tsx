// Sino de notificações (padrão da gestao-financeira-extensao): contador de não
// lidas e lista com backups, lembretes e outros avisos.
import { useEffect, useState } from "react";
import { Bell, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@tailadmin";
import { clearNotifications, listNotifications, markAllRead, NOTIFICATIONS_KEY, type AppNotification } from "../../lib/notifications";
import { formatDateTime } from "../../lib/format";
import { Popover } from "../ui/Popover";

const ICON = {
  success: <CheckCircle2 size={16} className="text-success-600" />,
  error: <XCircle size={16} className="text-error-600" />,
  info: <Info size={16} className="text-brand-500" />,
};

export function NotificationBell() {
  const [list, setList] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void listNotifications().then(setList);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[NOTIFICATIONS_KEY]) void listNotifications().then(setList);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const active = list.filter((n) => !n.cleared);
  const unread = active.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        type="button"
        title="Notificações"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="left-auto right-0 w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">Notificações</span>
          <span className="flex gap-3 text-theme-xs">
            <button type="button" className="text-brand-600 hover:underline disabled:opacity-40" disabled={!unread} onClick={() => void markAllRead()}>
              Marcar como lidas
            </button>
            <button type="button" className="text-gray-500 hover:underline disabled:opacity-40" disabled={!active.length} onClick={() => void clearNotifications()}>
              Limpar tudo
            </button>
          </span>
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {active.length === 0 && <li className="px-4 py-6 text-center text-theme-sm text-gray-400">Nenhuma notificação.</li>}
          {active.map((n) => (
            <li key={n.id} className={cn("flex gap-3 border-b border-gray-100 px-4 py-3 last:border-0 dark:border-gray-800", !n.read && "bg-brand-25 dark:bg-brand-500/5")}>
              <span className="mt-0.5">{ICON[n.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">{n.title}</span>
                <span className="block break-words text-theme-xs text-gray-600 dark:text-gray-400">{n.message}</span>
                <span className="block text-[11px] text-gray-400">{formatDateTime(n.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}
