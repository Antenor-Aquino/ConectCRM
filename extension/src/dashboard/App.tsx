import { useCallback, useEffect, useState } from "react";
import { Bell, Building2, CalendarDays, CircleCheck, Filter, LineChart, Settings, User, Workflow } from "lucide-react";
import { AppLayout, TaPanel, TopNavBar, type TopNavItem } from "@tailadmin";
import { call } from "../rpc/client";
import type { Pipeline, PipelineType } from "../db/pipelines";
import { FunnelsView } from "./components/FunnelsView";
import { QuickCreateMenu } from "./components/QuickCreateMenu";
import type { QuickCreateOption } from "../lib/quickCreate";
import { ComingSoonModal } from "./components/ComingSoonModal";

// Menu principal (spec 01, seção 1).
const NAV: TopNavItem[] = [
  { id: "funis", label: "Funis", icon: <Filter /> },
  { id: "tarefas", label: "Tarefas", icon: <CircleCheck /> },
  { id: "contatos", label: "Contatos", icon: <User /> },
  { id: "organizacoes", label: "Organizações", icon: <Building2 /> },
  { id: "relatorios", label: "Relatórios", icon: <LineChart /> },
  { id: "configuracoes", label: "Configurações", icon: <Settings /> },
];

const PHASE_BY_TAB: Record<string, string> = {
  tarefas: "Fase 7 — Tarefas e agenda",
  contatos: "Fase 5 — Contatos e Organizações",
  organizacoes: "Fase 5 — Contatos e Organizações",
  relatorios: "Fase 10 — Relatórios",
  configuracoes: "Fases 3, 6 e 8 — usuários, tags, campos personalizados, backup",
};

export function App() {
  const [tab, setTab] = useState("funis");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activeTypes, setActiveTypes] = useState<PipelineType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [list, types] = await Promise.all([call("pipelines.list", {}), call("pipelines.activeTypes")]);
      setPipelines(list);
      setActiveTypes(types);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onQuickCreate = (option: QuickCreateOption) => setComingSoon(`Cadastro de ${option.label.toLowerCase()}`);

  const iconButton = "flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5";

  return (
    <AppLayout
      header={
        <TopNavBar
          brandName="ConectCRM"
          brandIcon={<Workflow size={16} />}
          items={NAV}
          activeId={tab}
          onSelect={setTab}
          beforeNavEnd={<QuickCreateMenu activeTypes={activeTypes} onSelect={onQuickCreate} />}
          actions={
            <>
              <button type="button" className={iconButton} title="Notificações" onClick={() => setComingSoon("Central de notificações")}>
                <Bell size={18} />
              </button>
              <button type="button" className={iconButton} title="Agenda" onClick={() => setComingSoon("Agenda")}>
                <CalendarDays size={18} />
              </button>
            </>
          }
        />
      }
    >
      {error && (
        <div className="mb-4 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-theme-sm text-error-700">
          Não foi possível abrir o banco local: {error}
        </div>
      )}
      {tab === "funis" ? (
        <FunnelsView pipelines={pipelines} onChanged={reload} />
      ) : (
        <TaPanel title={NAV.find((n) => n.id === tab)?.label ?? ""} subtitle={PHASE_BY_TAB[tab]}>
          <p className="text-theme-sm text-gray-500">Em construção.</p>
        </TaPanel>
      )}
      <ComingSoonModal feature={comingSoon} onClose={() => setComingSoon(null)} />
    </AppLayout>
  );
}
