import { useCallback, useEffect, useState } from "react";
import { Building2, Sparkles, CalendarDays, CircleCheck, Filter, FolderArchive, LineChart, Settings, User, Workflow } from "lucide-react";
import { AppLayout, TopNavBar, cn, type TopNavItem } from "@tailadmin";
import { call, systemCall } from "../rpc/client";
import { checkAutoBackup, type AutoBackupCheck } from "../lib/autoBackup";
import { backupDocuments, checkDocumentExpiry } from "../lib/documentFiles";
import type { DbEnv } from "../lib/environment";
import type { Pipeline, PipelineType } from "../db/pipelines";
import type { QuickCreateOption } from "../lib/quickCreate";
import { CardFormModal, type CardFormRequest } from "./cards/CardFormModal";
import { AutoBackupPermissionModal } from "./components/AutoBackupPermissionModal";
import { ComingSoonModal } from "./components/ComingSoonModal";
import { COPILOT_EVENT, CopilotPanel, type CopilotRequest } from "./copilot/CopilotPanel";
import { EnvironmentSwitch } from "./components/EnvironmentSwitch";
import { NotificationBell } from "./components/NotificationBell";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { FunnelsView } from "./components/FunnelsView";
import { QuickCreateMenu } from "./components/QuickCreateMenu";
import { UserSwitcher } from "./components/UserSwitcher";
import { LicenseGate } from "./license/LicenseGate";
import { LockScreen } from "./components/LockScreen";
import { exportDatabase } from "./settings/BackupSettings";
import { DocumentNavProvider, type DocumentNav } from "./documents/docUi";
import { GedView } from "./documents/GedView";
import { ReportsView } from "./reports/ReportsView";
import { SettingsView } from "./settings/SettingsView";
import { OrganizationDetail } from "./contacts/OrganizationDetail";
import { OrganizationFormModal } from "./contacts/OrganizationFormModal";
import { OrganizationsView } from "./contacts/OrganizationsView";
import { PersonDetail } from "./contacts/PersonDetail";
import { PersonFormModal } from "./contacts/PersonFormModal";
import { PersonsView } from "./contacts/PersonsView";
import { TaskModal } from "./tasks/TaskModal";
import { TasksView } from "./tasks/TasksView";
import { SessionProvider, useSession } from "./session";

// Menu principal (spec 01, seção 1).
const NAV: TopNavItem[] = [
  { id: "funis", label: "Funis", icon: <Filter /> },
  { id: "tarefas", label: "Tarefas", icon: <CircleCheck /> },
  { id: "contatos", label: "Contatos", icon: <User /> },
  { id: "organizacoes", label: "Organizações", icon: <Building2 /> },
  { id: "ged", label: "GED", icon: <FolderArchive /> },
  { id: "relatorios", label: "Relatórios", icon: <LineChart /> },
];
// Configurações fica no ícone de engrenagem, à direita (abre espaço para o GED).
const SETTINGS_ITEM: TopNavItem = { id: "configuracoes", label: "Configurações", icon: <Settings /> };

const TYPE_BY_OPTION: Partial<Record<QuickCreateOption["id"], PipelineType>> = { negocio: "comercial", ticket: "operacional", projeto: "projeto" };

const SELECTED_KEY = "conectcrm-selected-pipeline";

export function App() {
  return (
    <LicenseGate>
      <SessionProvider
        setup={(done) => <FirstRunSetup onDone={done} />}
        locked={(user, s) => (
          <LockScreen user={user} users={s.users} onUnlock={(id) => void s.unlock(id)} onSwitch={(id) => void s.switchUser(id)} />
        )}
      >
        <Main />
      </SessionProvider>
    </LicenseGate>
  );
}

function Main() {
  const { user } = useSession();
  // #ged?... (filtros do GED na URL) abre direto no GED.
  const [tab, setTabState] = useState(() => (location.hash.startsWith("#ged") ? "ged" : "funis"));
  const setTab = (t: string) => {
    setTabState(t);
    if (t !== "ged" && location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);
  };
  /** Tarefa aberta a partir de um vínculo de documento. */
  const [taskOpen, setTaskOpen] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activeTypes, setActiveTypes] = useState<PipelineType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [cardForm, setCardForm] = useState<CardFormRequest | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  // Copiloto: painel lateral; pedidos de outras telas chegam por evento.
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotRequest, setCopilotRequest] = useState<CopilotRequest | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => {
      setCopilotRequest((e as CustomEvent<CopilotRequest>).detail);
      setCopilotOpen(true);
    };
    window.addEventListener(COPILOT_EVENT, onAsk);
    return () => window.removeEventListener(COPILOT_EVENT, onAsk);
  }, []);
  const [personOpen, setPersonOpen] = useState<string | null>(null);
  const [orgOpen, setOrgOpen] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState(false);
  const [newOrg, setNewOrg] = useState(false);
  const [contactsKey, setContactsKey] = useState(0);
  const [newTask, setNewTask] = useState(false);
  const [tasksKey, setTasksKey] = useState(0);
  const [tasksMode, setTasksMode] = useState<"lista" | "calendario">("lista");
  // Clique na notificação de lembrete: ?tarefa=<id> abre a tarefa.
  const [taskFromUrl, setTaskFromUrl] = useState<string | null>(() => new URLSearchParams(location.search).get("tarefa"));
  useEffect(() => {
    if (taskFromUrl) setTab("tarefas");
  }, [taskFromUrl]);
  const contactsChanged = () => setContactsKey((k) => k + 1);
  // Popup do WhatsApp → "Abrir no CRM": ?negocio=<id> abre o cartão no funil dele.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("negocio");
    if (!id) return;
    void call("cards.get", { id }).then((c) => c && openCardFrom(c.pipeline_id, c.id));
  }, []);

  // Ambiente (Produção/Teste) e backup automático ao abrir o CRM (só em Produção).
  const [env, setEnv] = useState<DbEnv | null>(null);
  const [backupPending, setBackupPending] = useState<Extract<AutoBackupCheck, { status: "needs-permission" }> | null>(null);
  useEffect(() => {
    void systemCall<DbEnv>("system.env").then((e) => {
      setEnv(e);
      void checkDocumentExpiry().catch(() => {});
      if (e !== "production") return;
      void checkAutoBackup(exportDatabase, backupDocuments).then((r) => {
        if (r.status === "needs-permission") setBackupPending(r);
      });
    });
  }, []);

  /** Abre um negócio/ticket/etapa a partir de uma ficha de contato ou organização. */
  const openCardFrom = (pipelineId: string, cardId: string) => {
    setPersonOpen(null);
    setOrgOpen(null);
    setTab("funis");
    select(pipelineId);
    setOpenCardId(cardId);
    // Funil criado depois que a lista foi carregada (ex.: pelo popup): recarrega.
    if (!pipelines.some((p) => p.id === pipelineId)) void reload();
  };

  const reload = useCallback(async () => {
    try {
      const [list, types] = await Promise.all([call("pipelines.list", {}), call("pipelines.activeTypes")]);
      setPipelines(list);
      setActiveTypes(types);
      setRefreshKey((k) => k + 1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, user.id]);

  const selected = pipelines.find((p) => p.id === selectedId) ?? pipelines[0] ?? null;
  const select = (id: string) => {
    setSelectedId(id);
    setOpenCardId(null);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* só conveniência */
    }
  };

  // Botão "+": cartão do tipo escolhido, já no funil aberto se o tipo combinar (spec 01, seção 3).
  const onQuickCreate = (option: QuickCreateOption) => {
    if (option.id === "tarefa") return setNewTask(true);
    if (option.id === "contato") return setNewPerson(true);
    if (option.id === "organizacao") return setNewOrg(true);
    const type = TYPE_BY_OPTION[option.id];
    if (!type) {
      setComingSoon(`Cadastro de ${option.label.toLowerCase()}`);
      return;
    }
    setCardForm({ type, pipelineId: selected?.type === type ? selected.id : undefined });
  };

  // Vínculos de documentos abrem o cadastro (cartão no funil, tarefa, contato, organização).
  const documentNav: DocumentNav = {
    openCard: openCardFrom,
    openPerson: (id) => {
      setOrgOpen(null);
      setPersonOpen(id);
    },
    openOrganization: (id) => {
      setPersonOpen(null);
      setOrgOpen(id);
    },
    openTask: setTaskOpen,
  };

  const iconButton = "flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5";

  return (
    <DocumentNavProvider value={documentNav}>
      <AppLayout
        demoMode={env === "demo"}
        header={
          <TopNavBar
            brandName="ConectCRM"
            brandIcon={<Workflow size={16} />}
            items={NAV}
            actionItems={[SETTINGS_ITEM]}
            activeId={tab}
            onSelect={setTab}
            beforeNavEnd={<QuickCreateMenu activeTypes={activeTypes} onSelect={onQuickCreate} />}
            actions={
              <>
                {env && <EnvironmentSwitch env={env} />}
                <button
                  type="button"
                  onClick={() => setCopilotOpen(true)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-brand-200 px-3 text-theme-sm font-medium text-brand-600 hover:bg-brand-50 dark:border-brand-500/30 dark:hover:bg-brand-500/10"
                >
                  <Sparkles size={16} /> Copiloto
                </button>
                <NotificationBell />
                <button
                  type="button"
                  className={iconButton}
                  title="Agenda"
                  onClick={() => {
                    setTasksMode("calendario");
                    setTab("tarefas");
                  }}
                >
                  <CalendarDays size={18} />
                </button>
                <button
                  type="button"
                  className={cn(iconButton, tab === "configuracoes" && "bg-brand-50 text-brand-600 dark:bg-brand-500/15")}
                  title="Configurações"
                  aria-label="Configurações"
                  onClick={() => setTab("configuracoes")}
                >
                  <Settings size={18} />
                </button>
                <UserSwitcher />
              </>
            }
          />
        }
      >
        {error && (
          <div className="mb-4 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-theme-sm text-error-700">Não foi possível abrir o banco local: {error}</div>
        )}
        {tab === "configuracoes" ? (
          env && <SettingsView env={env} />
        ) : tab === "tarefas" ? (
          <TasksView
            refreshKey={tasksKey}
            initialMode={tasksMode}
            openTaskId={taskFromUrl}
            onOpenTaskConsumed={() => {
              setTaskFromUrl(null);
              history.replaceState(null, "", location.pathname);
            }}
            links={{
              onOpenCard: openCardFrom,
              onOpenPerson: setPersonOpen,
              onOpenOrganization: setOrgOpen,
            }}
          />
        ) : tab === "contatos" ? (
          <PersonsView refreshKey={contactsKey} onOpen={setPersonOpen} onNew={() => setNewPerson(true)} />
        ) : tab === "organizacoes" ? (
          <OrganizationsView refreshKey={contactsKey} onOpen={setOrgOpen} onNew={() => setNewOrg(true)} />
        ) : tab === "ged" ? (
          <GedView />
        ) : tab === "funis" ? (
          <FunnelsView
            pipelines={pipelines}
            selected={selected}
            onSelect={select}
            refreshKey={refreshKey}
            onChanged={reload}
            onCreateCard={(p, stageId) => setCardForm({ type: p.type, pipelineId: p.id, stageId })}
            openCardId={openCardId}
            onOpenCard={setOpenCardId}
          />
        ) : (
          <ReportsView />
        )}
        <CardFormModal
          request={cardForm}
          pipelines={pipelines}
          onClose={() => setCardForm(null)}
          onCreated={(id, pipelineId, open) => {
            setCardForm(null);
            setTab("funis");
            select(pipelineId);
            void reload();
            if (open) setOpenCardId(id);
          }}
        />
        <ComingSoonModal feature={comingSoon} onClose={() => setComingSoon(null)} />
        <CopilotPanel
          open={copilotOpen}
          onClose={() => setCopilotOpen(false)}
          request={copilotRequest}
          onOpenCard={(id) => {
            void call("cards.get", { id }).then((c) => {
              if (!c) return;
              setCopilotOpen(false);
              openCardFrom(c.pipeline_id, c.id);
            });
          }}
        />
        {backupPending && <AutoBackupPermissionModal handle={backupPending.handle} settings={backupPending.settings} onClose={() => setBackupPending(null)} />}
        {taskOpen && (
          <TaskModal
            request={{ id: taskOpen }}
            onClose={() => setTaskOpen(null)}
            onSaved={() => {
              setTaskOpen(null);
              setTasksKey((k) => k + 1);
              setRefreshKey((k) => k + 1);
            }}
          />
        )}
        {newTask && (
          <TaskModal
            request={{}}
            onClose={() => setNewTask(false)}
            onSaved={() => {
              setNewTask(false);
              setTasksKey((k) => k + 1);
              setRefreshKey((k) => k + 1);
            }}
          />
        )}
        {newPerson && (
          <PersonFormModal
            personId={null}
            onClose={() => setNewPerson(false)}
            onOpenExisting={(id) => {
              setNewPerson(false);
              setPersonOpen(id);
            }}
            onSaved={(id) => {
              setNewPerson(false);
              contactsChanged();
              setPersonOpen(id);
            }}
          />
        )}
        {newOrg && (
          <OrganizationFormModal
            organizationId={null}
            onClose={() => setNewOrg(false)}
            onSaved={(id) => {
              setNewOrg(false);
              contactsChanged();
              setOrgOpen(id);
            }}
          />
        )}
        {personOpen && (
          <PersonDetail
            key={personOpen}
            personId={personOpen}
            onClose={() => setPersonOpen(null)}
            onChanged={contactsChanged}
            onOpenOrganization={(id) => {
              setPersonOpen(null);
              setOrgOpen(id);
            }}
            onOpenCard={openCardFrom}
          />
        )}
        {orgOpen && (
          <OrganizationDetail
            key={orgOpen}
            organizationId={orgOpen}
            onClose={() => setOrgOpen(null)}
            onChanged={contactsChanged}
            onOpenPerson={(id) => {
              setOrgOpen(null);
              setPersonOpen(id);
            }}
            onOpenCard={openCardFrom}
          />
        )}
      </AppLayout>
    </DocumentNavProvider>
  );
}
