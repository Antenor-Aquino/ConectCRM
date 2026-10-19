// Configurações: menu lateral com as seções. As que chegam em outras fases
// aparecem desabilitadas, com a fase indicada.
import { useEffect, useState } from "react";
import { Ban, Bell, Database, FileText, Plug, Sparkles, KeyRound, ListChecks, Mail, Package, SlidersHorizontal, Tags, Users, UsersRound } from "lucide-react";
import { TaPanel, cn } from "@tailadmin";
import { planLabel } from "../../lib/license";
import { useLicense } from "../license/LicenseGate";
import type { DbEnv } from "../../lib/environment";
import { ActivityTypesSettings } from "./ActivityTypesSettings";
import { AiSettings } from "./AiSettings";
import { BackupSettings } from "./BackupSettings";
import { CustomFieldsSettings } from "./CustomFieldsSettings";
import { DocumentsSettings } from "./DocumentsSettings";
import { EmailSettings } from "./EmailSettings";
import { IntegrationsSettings } from "./IntegrationsSettings";
import { NotificationsSettings } from "./NotificationsSettings";
import { LossReasonsSettings } from "./LossReasonsSettings";
import { ProductsSettings } from "./ProductsSettings";
import { TagsSettings } from "./TagsSettings";
import { TeamsSettings } from "./TeamsSettings";
import { UsersSettings } from "./UsersSettings";

type Section = "usuarios" | "equipes" | "licenca" | "tags" | "campos" | "produtos" | "motivos" | "tipos" | "documentos" | "backup" | "ia" | "email" | "notificacoes" | "integracoes";

const SECTIONS: { id: Section | null; label: string; icon: React.ReactNode; phase?: string }[] = [
  { id: "usuarios", label: "Usuários", icon: <Users size={16} /> },
  { id: "equipes", label: "Equipes", icon: <UsersRound size={16} /> },
  { id: "licenca", label: "Licença", icon: <KeyRound size={16} /> },
  { id: "tags", label: "Tags", icon: <Tags size={16} /> },
  { id: "campos", label: "Campos personalizados", icon: <SlidersHorizontal size={16} /> },
  { id: "produtos", label: "Produtos e serviços", icon: <Package size={16} /> },
  { id: "motivos", label: "Motivos de perda", icon: <Ban size={16} /> },
  { id: "tipos", label: "Tipos de atividade", icon: <ListChecks size={16} /> },
  { id: "documentos", label: "Documentos (GED)", icon: <FileText size={16} /> },
  { id: "email", label: "E-mail", icon: <Mail size={16} /> },
  { id: "notificacoes", label: "Notificações", icon: <Bell size={16} /> },
  { id: "ia", label: "Inteligência artificial", icon: <Sparkles size={16} /> },
  { id: "integracoes", label: "Integrações", icon: <Plug size={16} /> },
  { id: "backup", label: "Backup e ambiente", icon: <Database size={16} /> },
];

export function SettingsView({ env }: { env: DbEnv }) {
  const [section, setSection] = useState<Section>("usuarios");
  return (
    <div className="flex gap-5">
      <aside className="w-60 shrink-0 self-start rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-2 px-2 text-base font-semibold text-gray-800 dark:text-white/90">Configurações</h2>
        {SECTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={!s.id}
            onClick={() => s.id && setSection(s.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-theme-sm",
              s.id === section ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
              !s.id && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
          >
            {s.icon}
            <span className="flex-1">{s.label}</span>
            {s.phase && <span className="text-[10px] text-gray-400">{s.phase}</span>}
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1">
        {section === "usuarios" && <UsersSettings />}
        {section === "equipes" && <TeamsSettings />}
        {section === "licenca" && <LicensePanel />}
        {section === "tags" && <TagsSettings />}
        {section === "campos" && <CustomFieldsSettings />}
        {section === "produtos" && <ProductsSettings />}
        {section === "motivos" && <LossReasonsSettings />}
        {section === "tipos" && <ActivityTypesSettings />}
        {section === "documentos" && <DocumentsSettings env={env} />}
        {section === "email" && <EmailSettings />}
        {section === "notificacoes" && <NotificationsSettings />}
        {section === "integracoes" && <IntegrationsSettings />}
        {section === "ia" && (
          <div className="space-y-5">
            <AiSettings />
          </div>
        )}
        {section === "backup" && (
          <div className="space-y-5">
            <BackupSettings env={env} />
          </div>
        )}
      </div>
    </div>
  );
}

function LicensePanel() {
  const { result, openScreen, client } = useLicense();
  const [key, setKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void client.savedKey().then(setKey);
  }, [client]);
  const masked = key ? `${key.slice(0, 11)}••••-••••-${key.slice(-4)}` : "—";
  return (
    <TaPanel title="Licença" subtitle="Licença por instalação (este computador).">
      <dl className="mb-4 grid grid-cols-[140px_1fr] gap-y-2 text-theme-sm">
        <dt className="text-gray-500">Situação</dt>
        <dd className="font-medium text-success-600">{result.valida ? "Ativa" : "Inativa"}</dd>
        <dt className="text-gray-500">Plano</dt>
        <dd className="text-gray-800 dark:text-white/90">{planLabel(result.dados) || "—"}</dd>
        <dt className="text-gray-500">Chave</dt>
        <dd className="font-mono text-gray-800 dark:text-white/90">{masked}</dd>
      </dl>
      <button type="button" className="text-theme-sm font-medium text-brand-600 hover:underline" onClick={openScreen}>
        Gerenciar licença (trocar chave, assinar, upgrade, cancelar) →
      </button>
    </TaPanel>
  );
}
