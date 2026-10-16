import { useCallback, useEffect, useState } from "react";
import { Bell, Building2, CalendarDays, CircleCheck, Filter, LineChart, Settings, User, Workflow } from "lucide-react";
import { AppLayout, TaPanel, TopNavBar, type TopNavItem } from "@tailadmin";
import { call } from "../rpc/client";
import type { Pipeline, PipelineType } from "../db/pipelines";
import type { QuickCreateOption } from "../lib/quickCreate";
import { CardFormModal, type CardFormRequest } from "./cards/CardFormModal";
import { ComingSoonModal } from "./components/ComingSoonModal";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { FunnelsView } from "./components/FunnelsView";
import { QuickCreateMenu } from "./components/QuickCreateMenu";
import { UserSwitcher } from "./components/UserSwitcher";
import { LicenseGate } from "./license/LicenseGate";
import { LockScreen } from "./components/LockScreen";
import { SettingsView } from "./settings/SettingsView";
import { OrganizationDetail } from "./contacts/OrganizationDetail";
import { OrganizationFormModal } from "./contacts/OrganizationFormModal";
import { OrganizationsView } from "./contacts/OrganizationsView";
import { PersonDetail } from "./contacts/PersonDetail";
import { PersonFormModal } from "./contacts/PersonFormModal";
import { PersonsView } from "./contacts/PersonsView";
import { SessionProvider, useSession } from "./session";

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
  relatorios: "Fase 10 — Relatórios",
};

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
  const [tab, setTab] = useState("funis");
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
  const [personOpen, setPersonOpen] = useState<string | null>(null);
  const [orgOpen, setOrgOpen] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState(false);
  const [newOrg, setNewOrg] = useState(false);
  const [contactsKey, setContactsKey] = useState(0);
  const contactsChanged = () => setContactsKey((k) => k + 1);

  /** Abre um negócio/ticket/etapa a partir de uma ficha de contato ou organização. */
  const openCardFrom = (pipelineId: string, cardId: string) => {
    setPersonOpen(null);
    setOrgOpen(null);
    setTab("funis");
    select(pipelineId);
    setOpenCardId(cardId);
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
    if (option.id === "contato") return setNewPerson(true);
    if (option.id === "organizacao") return setNewOrg(true);
    const type = TYPE_BY_OPTION[option.id];
    if (!type) {
      setComingSoon(`Cadastro de ${option.label.toLowerCase()}`);
      return;
    }
    setCardForm({ type, pipelineId: selected?.type === type ? selected.id : undefined });
  };

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
        <SettingsView />
      ) : tab === "contatos" ? (
        <PersonsView refreshKey={contactsKey} onOpen={setPersonOpen} onNew={() => setNewPerson(true)} />
      ) : tab === "organizacoes" ? (
        <OrganizationsView refreshKey={contactsKey} onOpen={setOrgOpen} onNew={() => setNewOrg(true)} />
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
        <TaPanel title={NAV.find((n) => n.id === tab)?.label ?? ""} subtitle={PHASE_BY_TAB[tab]}>
          <p className="text-theme-sm text-gray-500">Em construção.</p>
        </TaPanel>
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
  );
}
