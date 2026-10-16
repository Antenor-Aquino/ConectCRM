// Popup sobre o WhatsApp Web (Fase 9): o mesmo fluxo do wa-pipedrive, gravando
// no CRM local. Usa a licença, o usuário atual e o PIN do CRM.
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FlaskConical, Workflow } from "lucide-react";
import { TaButton } from "@tailadmin";
import { call, systemCall } from "../rpc/client";
import type { PersonListItem } from "../db/contacts";
import type { Pipeline, PipelineType } from "../db/pipelines";
import type { DbEnv } from "../lib/environment";
import type { OpenChat } from "../lib/whatsapp";
import { CardFormModal, type CardFormRequest } from "../dashboard/cards/CardFormModal";
import { LockScreen } from "../dashboard/components/LockScreen";
import { LicenseGate } from "../dashboard/license/LicenseGate";
import { SessionProvider, useSession } from "../dashboard/session";
import { TaskModal, type TaskRequest } from "../dashboard/tasks/TaskModal";
import { Avatar } from "../dashboard/ui/Avatar";
import { ChatSection } from "./ChatSection";
import { ClipsSection } from "./ClipsSection";
import { FilesSection } from "./FilesSection";
import { TargetSection } from "./TargetSection";
import { useTarget } from "./target";
import { openCrm } from "./ui";

export function Popup() {
  return (
    <div className="min-h-[580px] w-[460px] bg-gray-50 font-outfit text-gray-800 dark:bg-gray-950">
      <LicenseGate>
        <SessionProvider
          setup={() => (
            <div className="p-6 text-center">
              <p className="mb-4 text-theme-sm text-gray-600">Abra o CRM para cadastrar o primeiro usuário.</p>
              <TaButton variant="primary" onClick={() => openCrm()}>
                Abrir o CRM
              </TaButton>
            </div>
          )}
          locked={(user, s) => <LockScreen user={user} users={s.users} onUnlock={(id) => void s.unlock(id)} onSwitch={(id) => void s.switchUser(id)} />}
        >
          <Main />
        </SessionProvider>
      </LicenseGate>
    </div>
  );
}

function Main() {
  const { user, label } = useSession();
  const [env, setEnv] = useState<DbEnv | null>(null);
  const [targetId, setTarget, targetLoaded] = useTarget();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activeTypes, setActiveTypes] = useState<PipelineType[]>([]);
  const [contact, setContact] = useState<{ chat: OpenChat | null; person: PersonListItem | null }>({ chat: null, person: null });
  const [cardForm, setCardForm] = useState<CardFormRequest | null>(null);
  const [task, setTask] = useState<TaskRequest | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    void systemCall<DbEnv>("system.env").then(setEnv);
    void Promise.all([call("pipelines.list", {}), call("pipelines.activeTypes")]).then(([list, types]) => {
      setPipelines(list);
      setActiveTypes(types);
    });
  }, []);

  const onContact = useCallback((chat: OpenChat | null, person: PersonListItem | null) => setContact({ chat, person }), []);

  const newCard = (type: PipelineType, person?: { id: string; label: string }) => {
    const p = person ?? (contact.person ? { id: contact.person.id, label: contact.person.name } : null);
    setCardForm({ type, person: p, origin: contact.chat?.open ? "WhatsApp" : undefined });
  };

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
          <Workflow size={16} />
        </span>
        <span className="text-sm font-bold text-gray-900 dark:text-white">ConectCRM</span>
        {env === "demo" && (
          <span className="flex items-center gap-1 rounded-full bg-warning-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
            <FlaskConical size={10} /> Teste
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-theme-xs text-gray-600 dark:text-gray-400" title={label(user)}>
          <Avatar name={user.name} size={22} />
          <span className="max-w-[110px] truncate">{user.name}</span>
        </span>
        <button type="button" title="Abrir o CRM" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100" onClick={() => openCrm()}>
          <ExternalLink size={16} />
        </button>
      </header>

      <main className="space-y-3 p-3">
        <ChatSection targetId={targetId} onPick={setTarget} onNewCard={(person) => newCard(activeTypes[0] ?? "comercial", person)} onContact={onContact} />
        {targetLoaded && (
          <TargetSection
            targetId={targetId}
            setTarget={setTarget}
            refreshKey={refreshKey}
            activeTypes={activeTypes}
            onNewCard={(t) => newCard(t)}
            onNewTask={(meeting) => targetId && setTask({ dealId: targetId, meeting })}
          />
        )}
        <ClipsSection targetId={targetId} onSent={refresh} />
        <FilesSection targetId={targetId} onSent={refresh} />
      </main>

      <CardFormModal
        request={cardForm}
        pipelines={pipelines}
        onClose={() => setCardForm(null)}
        onCreated={(id, _pipelineId, open) => {
          setCardForm(null);
          setTarget(id);
          refresh();
          if (open) openCrm(`?negocio=${id}`);
        }}
      />
      {task && (
        <TaskModal
          request={task}
          onClose={() => setTask(null)}
          onSaved={() => {
            setTask(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
