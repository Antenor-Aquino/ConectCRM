// Janela de aviso (spec 10): mostra os lembretes e avisos do Chrome numa
// janelinha do CRM, que aparece mesmo com as notificações do sistema
// desligadas ou em "Não perturbe". Fica até a pessoa agir.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlarmClock, Bell, Check, ExternalLink } from "lucide-react";
import "@fontsource-variable/inter";
import "../../../shared/tailadmin/tailwind.css";
import { ThemeProvider, TaButton } from "@tailadmin";
import { ALERTS_KEY, type AlertActionMessage, type AlertItem } from "../lib/notify/alerts";

const act = (id: string, action: AlertActionMessage["action"]) =>
  chrome.runtime.sendMessage({ target: "background", kind: "alert-action", id, action } satisfies AlertActionMessage);

function AlertWindow() {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const load = () => void chrome.storage.session.get(ALERTS_KEY).then((r) => setItems(((r[ALERTS_KEY] as AlertItem[] | undefined) ?? []).slice().reverse()));
    load();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes[ALERTS_KEY]) load();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  useEffect(() => {
    document.title = items.length ? `(${items.length}) Avisos do ConectCRM` : "Avisos do ConectCRM";
  }, [items.length]);

  const run = async (id: string, action: AlertActionMessage["action"]) => {
    setBusy(`${id}:${action}`);
    try {
      await act(id, action);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-950" data-alert-window>
      <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        <img src={chrome.runtime.getURL("icons/icon48.png")} alt="" className="h-6 w-6" />
        <span className="flex-1 text-theme-sm font-semibold text-gray-800 dark:text-white/90">Avisos do ConectCRM</span>
        {items.length > 1 && (
          <button type="button" className="text-theme-xs text-gray-500 hover:underline" onClick={() => void Promise.all(items.map((a) => act(a.id, "ok")))}>
            Dispensar todos
          </button>
        )}
      </header>
      <main className="flex-1 space-y-2 overflow-y-auto p-3">
        {items.length === 0 && <p className="py-10 text-center text-theme-sm text-gray-400">Nenhum aviso pendente.</p>}
        {items.map((a) => (
          <article key={a.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900" data-alert={a.id}>
            <div className="flex items-start gap-2">
              <Bell size={16} className="mt-0.5 shrink-0 text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{a.title}</p>
                {a.message && <p className="mt-0.5 whitespace-pre-line text-theme-xs text-gray-600 dark:text-gray-400">{a.message}</p>}
                <p className="mt-1 text-[11px] text-gray-400">{new Date(a.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {a.task && (
                <>
                  <TaButton size="sm" variant="primary" startIcon={<Check size={14} />} disabled={!!busy} onClick={() => void run(a.id, "done")}>
                    Concluir
                  </TaButton>
                  <TaButton size="sm" startIcon={<AlarmClock size={14} />} disabled={!!busy} onClick={() => void run(a.id, "snooze")}>
                    Adiar 10 min
                  </TaButton>
                </>
              )}
              <TaButton size="sm" startIcon={<ExternalLink size={14} />} disabled={!!busy} onClick={() => void run(a.id, "open")}>
                Abrir
              </TaButton>
              <TaButton size="sm" variant="ghost" disabled={!!busy} onClick={() => void run(a.id, "ok")}>
                OK
              </TaButton>
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AlertWindow />
    </ThemeProvider>
  </StrictMode>,
);
