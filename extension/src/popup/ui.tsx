// Peças visuais do popup (cartões de seção e mensagens de status).
import { useEffect, useState, type ReactNode } from "react";
import { cn, TaSelect } from "@tailadmin";
import { call } from "../rpc/client";
import type { OpenCardMessage } from "../rpc/protocol";
import type { DocumentType } from "../db/documents";

export function Section({ title, icon, children, aside }: { title: string; icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 flex items-center gap-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        <span className="text-brand-500">{icon}</span>
        <span className="flex-1">{title}</span>
        {aside}
      </h2>
      {children}
    </section>
  );
}

export type Status = { text: string; kind: "ok" | "err" | "info" } | null;

export function StatusText({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p
      className={cn(
        "mt-2 rounded-lg px-3 py-2 text-theme-xs",
        status.kind === "ok" && "bg-success-50 text-success-700",
        status.kind === "err" && "bg-error-50 text-error-700",
        status.kind === "info" && "bg-brand-50 text-brand-700",
      )}
    >
      {status.text}
    </p>
  );
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Abre o CRM em tela cheia (aba do navegador). Se já houver uma aba do CRM,
 * ativa ela em vez de abrir outra; com `cardId`, abre o cartão no funil dele. */
export async function openCrm(cardId?: string): Promise<void> {
  const base = chrome.runtime.getURL("src/dashboard/dashboard.html");
  try {
    const tabs = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
    const tab = tabs.find((c) => c.documentUrl?.startsWith(base) && c.tabId >= 0);
    if (tab) {
      if (cardId) {
        const msg: OpenCardMessage = { target: "dashboard", kind: "open-card", tabId: tab.tabId, cardId };
        const ok = await chrome.runtime.sendMessage(msg).catch(() => false);
        // Aba sem resposta (ex.: tela de bloqueio): recarrega já no cartão.
        if (ok !== true) await chrome.tabs.update(tab.tabId, { url: `${base}?negocio=${cardId}` });
      }
      await chrome.tabs.update(tab.tabId, { active: true });
      if (tab.windowId >= 0) await chrome.windows.update(tab.windowId, { focused: true });
      window.close();
      return;
    }
  } catch {
    // Chrome sem getContexts: abre uma aba nova.
  }
  await chrome.tabs.create({ url: cardId ? `${base}?negocio=${cardId}` : base });
  window.close();
}

/** Classificação do documento (GED); `preferred` escolhe um tipo pelo nome ao abrir. */
export function DocumentTypeSelect({ value, onChange, preferred }: { value: string; onChange: (id: string) => void; preferred?: string }) {
  const [types, setTypes] = useState<DocumentType[]>([]);
  useEffect(() => {
    void call("documentTypes.list", {}).then((list) => {
      setTypes(list);
      const p = preferred && list.find((t) => t.name === preferred);
      if (p && !value) onChange(p.id);
    });
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <TaSelect aria-label="Classificação" className="h-9 text-theme-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Classificação *</option>
      {types.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </TaSelect>
  );
}
