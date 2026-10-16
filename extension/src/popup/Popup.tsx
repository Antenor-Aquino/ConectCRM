// Popup: na Fase 9 recebe a integração com o WhatsApp Web (como o
// wa-pipedrive). Por enquanto só abre o CRM.
import { Workflow } from "lucide-react";
import { TaButton } from "@tailadmin";

export function Popup() {
  const open = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
    window.close();
  };
  return (
    <div className="w-[300px] bg-white p-4 font-outfit">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
          <Workflow size={16} />
        </span>
        <span className="text-sm font-bold text-gray-900">ConectCRM</span>
      </div>
      <TaButton variant="primary" className="w-full" onClick={open}>
        Abrir o CRM
      </TaButton>
    </div>
  );
}
