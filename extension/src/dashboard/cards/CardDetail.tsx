// Detalhe do cartão (Fase 4): dados editáveis, etapas, desfecho (ganho/perdido,
// resolvido/não resolvido, concluído/não concluído conforme o tipo),
// notas, tarefas e histórico de alterações.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Check, CheckCircle2, Circle, Maximize2, Minimize2, Pencil, PlusCircle, RotateCcw, Sparkles, Trash2, Trophy, X, XCircle } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaTextarea, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { ActivityListItem } from "../../db/activities";
import type { CustomField, CustomValue } from "../../db/customFields";
import type { CardDetail as CardData } from "../../db/deals";
import type { HistoryEvent, HistoryRef } from "../../db/cardHistory";
import type { Pipeline, Stage } from "../../db/pipelines";
import { CARD_TEXT, OUTCOME_TEXT } from "../../lib/cardTypes";
import { formatCents, formatDateTime, fromDateInput, toDateInput } from "../../lib/format";
import { Combobox, type ComboItem } from "../ui/Combobox";
import { CustomFieldsForm } from "../ui/CustomFieldsForm";
import { ErrorText, Field, SectionLabel } from "../ui/form";
import { MoneyInput } from "../ui/MoneyInput";
import { SlaPicker } from "../ui/SlaPicker";
import { stageColor } from "../ui/StageSelect";
import { TagPicker } from "../ui/TagPicker";
import { UserSelect } from "../ui/UserSelect";
import { OrganizationFormModal } from "../contacts/OrganizationFormModal";
import { PersonFormModal } from "../contacts/PersonFormModal";
import { UserModal } from "../settings/UsersSettings";
import { useSession } from "../session";
import { openCopilot } from "../copilot/CopilotPanel";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { NotesPanel } from "../ui/NotesPanel";
import { TaskModal, type TaskRequest } from "../tasks/TaskModal";
import { DocumentViewer } from "../documents/DocumentViewer";
import { ActivityIcon } from "../../lib/activityIcons";
import { taskTiming } from "../../lib/taskTiming";
import { ItemsEditor, type ItemDraft } from "./ItemsEditor";
import { LostModal } from "./LostModal";
import { ChangePipelineModal } from "./ChangePipelineModal";
import { createOrganizationQuick, createPersonQuick, searchOrganizations, searchPersons } from "./searchers";
import { errorText } from "../../lib/errors";
import { RECURRENCE_LABEL, type Recurrence } from "../../db/products";

type Tab = "notas" | "tarefas" | "documentos" | "historico";

export type CardDetailMode = "drawer" | "full";

export function CardDetail({
  cardId,
  pipeline,
  onClose,
  onChanged,
  mode = "drawer",
  onToggleMode,
  pipelines = [],
  onMovedPipeline,
}: {
  cardId: string;
  pipeline: Pipeline;
  /** Funis para "Mudar de funil" (só os do mesmo tipo aparecem). */
  pipelines?: Pipeline[];
  /** O cartão foi para outro funil: a tela abre esse funil com o cartão. */
  onMovedPipeline?: (pipelineId: string) => void;
  onClose: () => void;
  onChanged: () => void;
  /** drawer = painel lateral sobre o quadro; full = ocupa a área do quadro. */
  mode?: CardDetailMode;
  onToggleMode?: () => void;
}) {
  const text = CARD_TEXT[pipeline.type];
  const [card, setCard] = useState<CardData | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("notas");
  // Origem aberta a partir do histórico.
  const [noteFocus, setNoteFocus] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState<string | null>(null);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [changingPipeline, setChangingPipeline] = useState(false);
  // Cadastro aberto a partir do nome do contato, da organização ou do responsável.
  const [editing, setEditing] = useState<{ kind: "person" | "organization" | "user"; id: string } | null>(null);
  const { user: me, users, reloadUsers } = useSession();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    const c = await call("cards.get", { id: cardId });
    if (!c) {
      setError("Cartão não encontrado ou sem permissão de acesso.");
      return;
    }
    setCard(c);
    setTitle(c.title);
    setDescription(c.description ?? "");
  }, [cardId]);

  useEffect(() => {
    void load();
    void call("stages.list", { pipelineId: pipeline.id }).then(setStages);
    void call("customFields.list", { entity: text.kind, pipelineId: pipeline.id }).then(setFields);
  }, [load, pipeline.id, text.kind]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const update = (patch: Record<string, unknown>) => run(() => call("cards.update", { id: cardId, patch }));

  if (!card) {
    return (
      <Shell onClose={onClose} mode={mode} onToggleMode={onToggleMode}>
        <ErrorText>{error}</ErrorText>
      </Shell>
    );
  }

  const outcome = OUTCOME_TEXT[pipeline.type];
  const status = card.status === "open" ? null : { color: card.status === "won" ? ("green" as const) : ("red" as const), label: outcome[card.status] };
  const person: ComboItem | null = card.person_id ? { id: card.person_id, label: card.person_name ?? "" } : null;
  const org: ComboItem | null = card.organization_id ? { id: card.organization_id, label: card.organization_name ?? "" } : null;
  const items: ItemDraft[] = card.items.map((i) => ({
    id: i.id,
    productId: i.product_id,
    description: i.description,
    quantity: i.quantity,
    unitPriceCents: i.unit_price_cents,
    discountCents: i.discount_cents,
    recurrence: i.recurrence,
  }));

  return (
    <Shell onClose={onClose} mode={mode} onToggleMode={onToggleMode}>
      {/* Cabeçalho */}
      <div className={cn("flex items-start gap-3", onToggleMode ? "pr-20" : "pr-8")}>
        <input
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-theme-xl font-semibold text-gray-800 hover:border-gray-200 focus:border-brand-300 focus:outline-none dark:text-white/90"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== card.title && void update({ title })}
        />
        {status && <TaBadge color={status.color} label={status.label} />}
      </div>
      <p className="mb-4 flex flex-wrap items-center gap-1 px-1 text-theme-xs text-gray-500">
        {onMovedPipeline ? (
          <button
            type="button"
            title="Mudar de funil"
            onClick={() => setChangingPipeline(true)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
          >
            {pipeline.name} <ArrowLeftRight size={12} />
          </button>
        ) : (
          pipeline.name
        )}
        <span>· criado em {formatDateTime(card.created_at)}</span>
      </p>

      {/* Etapas: clicar move o cartão */}
      <div className="mb-4 flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
        {stages.map((s, i) => {
          const reached = stages.findIndex((x) => x.id === card.stage_id) >= i;
          return (
            <button
              key={s.id}
              type="button"
              title={`Mover para ${s.name}`}
              onClick={() => s.id !== card.stage_id && void run(() => call("cards.move", { id: cardId, stageId: s.id }))}
              className={cn(
                "flex-1 truncate border-r border-white/40 px-2 py-1.5 text-theme-xs font-medium last:border-r-0",
                reached ? "text-white" : "bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-white/5",
              )}
              style={reached ? { background: stageColor(s.color) } : undefined}
            >
              {s.name}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {card.status === "open" ? (
          <>
            <TaButton
              className="!bg-success-600 !text-white !ring-0 hover:!bg-success-700"
              startIcon={pipeline.type === "comercial" ? <Trophy size={15} /> : <CheckCircle2 size={15} />}
              onClick={() => void run(() => call("cards.setStatus", { id: cardId, status: "won" }))}
            >
              {outcome.won}
            </TaButton>
            <TaButton variant="danger" startIcon={<XCircle size={15} />} onClick={() => setLostOpen(true)}>
              {outcome.lost}
            </TaButton>
          </>
        ) : (
          <TaButton startIcon={<RotateCcw size={15} />} onClick={() => void run(() => call("cards.setStatus", { id: cardId, status: "open" }))}>
            Reabrir
          </TaButton>
        )}
        <TaButton
          className="ml-auto"
          startIcon={<Sparkles size={15} />}
          onClick={() =>
            openCopilot({
              cardId,
              question: `Resuma ${card.kind === "deal" ? "este negócio" : card.kind === "ticket" ? "este ticket" : "esta etapa do projeto"} e sugira o próximo passo.`,
            })
          }
        >
          Perguntar ao Copiloto
        </TaButton>
        <TaButton
          variant="ghost"
          startIcon={<Trash2 size={15} />}
          onClick={() => {
            if (confirm(`Excluir este ${text.noun}?`)) void run(() => call("cards.delete", { id: cardId })).then(onClose);
          }}
        >
          Excluir
        </TaButton>
      </div>
      {card.status !== "open" && (
        // Faixa do desfecho: verde (ganho/resolvido/concluído) ou vermelha (perdido/não…), com data e motivo.
        <div
          className={cn(
            "mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-theme-sm",
            card.status === "won" ? "border-success-200 bg-success-50 text-success-800" : "border-error-200 bg-error-50 text-error-800",
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white",
              card.status === "won" ? "bg-success-500" : "bg-error-500",
            )}
          >
            {card.status === "won" ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
          </span>
          <span>
            <b>{outcome[card.status]}</b>
            {card.closed_at && ` em ${formatDateTime(card.closed_at)}`}
            {card.status === "lost" && card.loss_reason_name && (
              <span className="block">
                {outcome.lossReason}: {card.loss_reason_name}
              </span>
            )}
            {card.status === "lost" && card.loss_note && <span className="block">{card.loss_note}</span>}
          </span>
        </div>
      )}
      <ErrorText>{error}</ErrorText>

      {/* Colunas pela largura do próprio painel (não da janela): estreito, uma coluna só. */}
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] @6xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {/* Dados */}
        <div>
          {/* Valor e produtos/serviços em todos os tipos de funil. */}
          {
            <>
              <SectionLabel className="mt-0">Valor</SectionLabel>
              <div className="flex items-center gap-3">
                <div className="w-1/2">
                  {card.value_from_items ? (
                    <div className="flex h-10 items-center rounded-lg bg-gray-50 px-3.5 text-theme-sm dark:bg-white/5">{formatCents(card.value_cents)}</div>
                  ) : (
                    <MoneyInput value={card.value_cents} onChange={(c) => c !== card.value_cents && void update({ valueCents: c })} />
                  )}
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-theme-sm font-medium text-brand-600 hover:underline"
                  onClick={() => setItemsOpen(true)}
                >
                  <PlusCircle size={16} />
                  {card.items.length ? `${card.items.length} produto(s)` : "Adicionar"}
                </button>
              </div>
              {card.items.length > 0 && <ItemsSummary items={card.items} onEdit={() => setItemsOpen(true)} />}
            </>
          }
          {pipeline.type !== "comercial" && (
            <Field label="Descrição">
              <TaTextarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => description !== (card.description ?? "") && void update({ description })}
              />
            </Field>
          )}
          {pipeline.type === "operacional" && (
            <Field label="SLA">
              <SlaPicker value={card.sla_at} onChange={(v) => void update({ slaAt: v })} />
            </Field>
          )}
          {pipeline.type === "projeto" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Início">
                <TaInput type="date" value={toDateInput(card.start_at)} onChange={(e) => void update({ startAt: fromDateInput(e.target.value) })} />
              </Field>
              <Field label="Prazo">
                <TaInput type="date" value={toDateInput(card.due_at)} onChange={(e) => void update({ dueAt: fromDateInput(e.target.value) })} />
              </Field>
            </div>
          )}

          <SectionLabel>Relacionamento</SectionLabel>
          <Field label="Contato">
            <Combobox
              value={person}
              onChange={(i) => void update({ personId: i?.id ?? null })}
              search={searchPersons}
              placeholder="Buscar por nome, telefone ou e-mail"
              onCreate={createPersonQuick}
              createLabel="Criar contato"
              onOpenValue={(i) => setEditing({ kind: "person", id: i.id })}
              openTitle="Editar o cadastro do contato"
            />
          </Field>
          <Field label="Organização">
            <Combobox
              value={org}
              onChange={(i) => void update({ organizationId: i?.id ?? null })}
              search={searchOrganizations}
              placeholder="Buscar organização"
              onCreate={createOrganizationQuick}
              createLabel="Criar organização"
              dashed={
                <>
                  <PlusCircle size={15} /> Vincular ou criar organização
                </>
              }
              onOpenValue={(i) => setEditing({ kind: "organization", id: i.id })}
              openTitle="Editar o cadastro da organização"
            />
          </Field>

          <SectionLabel>Mais detalhes</SectionLabel>
          <Field label="Responsável">
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <UserSelect value={card.owner_id} onChange={(id) => void update({ ownerId: id })} />
              </div>
              {/* Usuários: administrador edita qualquer um; os demais, só o próprio cadastro. */}
              {card.owner_id && (me.role === "admin" || me.id === card.owner_id) && (
                <button
                  type="button"
                  title="Editar o cadastro do responsável"
                  onClick={() => setEditing({ kind: "user", id: card.owner_id! })}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:text-brand-600 dark:border-gray-700"
                >
                  <Pencil size={15} />
                </button>
              )}
            </div>
          </Field>
          <Field label="Tags">
            <TagPicker entity={text.kind} value={card.tags.map((t) => t.id)} onChange={(ids) => void update({ tagIds: ids })} />
          </Field>
          <CustomFieldsForm
            fields={fields}
            values={card.customValues}
            onChange={(values: Record<string, CustomValue>) => {
              setCard({ ...card, customValues: values });
            }}
          />
          {fields.some((f) => !f.hidden) && (
            <TaButton size="sm" onClick={() => void update({ customValues: card.customValues })}>
              Salvar campos personalizados
            </TaButton>
          )}
        </div>

        {/* Atividade */}
        <div>
          <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
            {(
              [
                ["historico", "Histórico"],
                ["notas", "Notas"],
                ["tarefas", "Atividades"],
                ["documentos", "Documentos"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  setNoteFocus(null);
                }}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-theme-sm font-medium",
                  tab === id ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-900" : "text-gray-600 dark:text-gray-400",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "notas" && <NotesPanel entityType="deal" entityId={cardId} onChanged={onChanged} highlightId={noteFocus} />}
          {tab === "tarefas" && <TasksTab cardId={cardId} onChanged={onChanged} />}
          {tab === "documentos" && <DocumentsPanel type="deal" id={cardId} />}
          {tab === "historico" && (
            <HistoryTab
              cardId={cardId}
              stageHistory={card.stageHistory}
              refreshKey={card.version}
              onOpen={(ref) => {
                if (ref.kind === "note") {
                  setNoteFocus(ref.id);
                  setTab("notas");
                } else if (ref.kind === "activity") setTaskOpen(ref.id);
                else setDocOpen(ref.id);
              }}
            />
          )}
        </div>
      </div>

      {taskOpen && (
        <TaskModal
          request={{ id: taskOpen }}
          onClose={() => setTaskOpen(null)}
          onSaved={() => {
            setTaskOpen(null);
            void load();
            onChanged();
          }}
        />
      )}
      {docOpen && <DocumentViewer documentId={docOpen} onClose={() => setDocOpen(null)} />}

      <ItemsEditor
        open={itemsOpen}
        items={items}
        onClose={() => setItemsOpen(false)}
        onSave={(list) => {
          setItemsOpen(false);
          void run(() => call("cards.setItems", { id: cardId, items: list }));
        }}
      />
      {editing?.kind === "person" && (
        <PersonFormModal
          personId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
            onChanged();
          }}
        />
      )}
      {editing?.kind === "organization" && (
        <OrganizationFormModal
          organizationId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
            onChanged();
          }}
        />
      )}
      {editing?.kind === "user" && users.some((u) => u.id === editing.id) && (
        <UserModal
          target={users.find((u) => u.id === editing.id)!}
          isAdmin={me.role === "admin"}
          isSelf={me.id === editing.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reloadUsers();
            void load();
            onChanged();
          }}
        />
      )}
      {changingPipeline && onMovedPipeline && (
        <ChangePipelineModal
          cardId={cardId}
          pipeline={pipeline}
          currentStage={stages.find((x) => x.id === card.stage_id)}
          pipelines={pipelines}
          onClose={() => setChangingPipeline(false)}
          onMoved={(id) => {
            setChangingPipeline(false);
            onChanged();
            onMovedPipeline(id);
          }}
        />
      )}
      <LostModal
        cardId={lostOpen ? cardId : null}
        type={pipeline.type}
        onClose={() => setLostOpen(false)}
        onDone={() => {
          setLostOpen(false);
          void load();
          onChanged();
        }}
      />
    </Shell>
  );
}

/** Resumo dos produtos/serviços logo abaixo do valor (clique abre o editor). */
function ItemsSummary({ items, onEdit }: { items: CardData["items"]; onEdit: () => void }) {
  const qty = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full text-theme-xs">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left uppercase tracking-wide text-gray-400 dark:border-gray-800 dark:bg-white/5">
            <th className="px-2.5 py-2 font-semibold">Produto/serviço</th>
            <th className="px-2.5 py-2 text-right font-semibold">Qtd</th>
            <th className="px-2.5 py-2 text-right font-semibold">Preço unit.</th>
            <th className="px-2.5 py-2 text-right font-semibold">Desc.</th>
            <th className="px-2.5 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr
              key={i.id}
              onClick={onEdit}
              className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5"
            >
              <td className="px-2.5 py-2 text-gray-800 dark:text-white/90">
                {i.description}
                {i.recurrence !== "avulso" && <span className="ml-1 text-gray-400">({RECURRENCE_LABEL[i.recurrence as Recurrence] ?? i.recurrence})</span>}
              </td>
              <td className="px-2.5 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{qty(i.quantity)}</td>
              <td className="px-2.5 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatCents(i.unit_price_cents)}</td>
              <td className="px-2.5 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{i.discount_cents ? formatCents(i.discount_cents) : "—"}</td>
              <td className="px-2.5 py-2 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">{formatCents(i.total_cents)}</td>
            </tr>
          ))}
        </tbody>
        {items.length > 1 && (
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50 font-semibold dark:border-gray-800 dark:bg-white/5">
              <td className="px-2.5 py-2 text-gray-700 dark:text-gray-300" colSpan={4}>
                Total
              </td>
              <td className="px-2.5 py-2 text-right tabular-nums text-gray-800 dark:text-white/90">
                {formatCents(items.reduce((a, i) => a + i.total_cents, 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Shell({ children, onClose, mode, onToggleMode }: { children: React.ReactNode; onClose: () => void; mode: CardDetailMode; onToggleMode?: () => void }) {
  const buttons = (
    <div className="absolute right-5 top-5 flex gap-1.5">
      {onToggleMode && (
        <button
          type="button"
          onClick={onToggleMode}
          title={mode === "full" ? "Voltar ao painel lateral" : "Abrir em tela cheia (no lugar do quadro)"}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/5"
        >
          {mode === "full" ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        title="Fechar"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/5"
      >
        <X size={18} />
      </button>
    </div>
  );
  if (mode === "full") {
    return (
      <section className="@container relative min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        {buttons}
        {children}
      </section>
    );
  }
  return (
    <div className="fixed inset-0 z-[9999] flex justify-end">
      <div className="fixed inset-0 bg-gray-900/40" onClick={onClose} aria-hidden />
      <div className="@container relative h-full w-full max-w-[1100px] overflow-y-auto bg-white p-6 shadow-theme-xl dark:bg-gray-900">
        {buttons}
        {children}
      </div>
    </div>
  );
}

function TasksTab({ cardId, onChanged }: { cardId: string; onChanged: () => void }) {
  const [tasks, setTasks] = useState<ActivityListItem[]>([]);
  const [modal, setModal] = useState<TaskRequest | null>(null);
  const load = useCallback(() => call("activities.list", { dealId: cardId }).then(setTasks), [cardId]);
  useEffect(() => {
    void load();
  }, [load]);
  const after = async () => {
    await load();
    onChanged();
  };
  return (
    <div>
      <TaButton variant="primary" startIcon={<PlusCircle size={15} />} onClick={() => setModal({ dealId: cardId })}>
        Nova atividade
      </TaButton>
      <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
        {tasks.map((t) => {
          const timing = taskTiming(t);
          const overdue = timing.tone === "danger";
          return (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <button
                type="button"
                title={t.done ? "Reabrir" : "Concluir"}
                onClick={async () => {
                  await call("activities.setDone", { id: t.id, done: !t.done });
                  await after();
                }}
                className={t.done ? "text-success-600" : "text-gray-400 hover:text-success-600"}
              >
                {t.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              </button>
              <span className="text-brand-500">
                <ActivityIcon name={t.type_icon} />
              </span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setModal({ id: t.id })}>
                <p className={cn("truncate text-theme-sm", t.done ? "text-gray-400 line-through" : "text-gray-800 dark:text-white/90")}>{t.title}</p>
                <p className={cn("text-theme-xs", overdue ? "text-error-600" : "text-gray-400")}>
                  {t.type_name} · {formatDateTime(t.due_at)} · {timing.label}
                  {t.owner_name && ` · ${t.owner_name}`}
                </p>
              </button>
            </li>
          );
        })}
        {tasks.length === 0 && <p className="py-2 text-theme-sm text-gray-400">Nenhuma atividade.</p>}
      </ul>
      {modal && (
        <TaskModal
          request={modal}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await after();
          }}
        />
      )}
    </div>
  );
}

const REF_TITLE: Record<HistoryRef["kind"], string> = { note: "Abrir a nota", activity: "Abrir a atividade", document: "Abrir o documento" };

function HistoryTab({
  cardId,
  stageHistory,
  refreshKey,
  onOpen,
}: {
  cardId: string;
  stageHistory: CardData["stageHistory"];
  refreshKey: unknown;
  onOpen: (ref: HistoryRef) => void;
}) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  useEffect(() => {
    void call("cards.history", { id: cardId }).then(setEvents);
  }, [cardId, refreshKey]);
  return (
    <div>
      <SectionLabel className="mt-0">Etapas</SectionLabel>
      <ul className="mb-4 space-y-1 text-theme-sm">
        {stageHistory.map((h, i) => (
          <li key={i} className="flex justify-between text-gray-700 dark:text-gray-300">
            <span>{h.stage_name}</span>
            <span className="text-theme-xs text-gray-400">
              {formatDateTime(h.entered_at)}
              {h.left_at ? ` → ${formatDateTime(h.left_at)}` : " (atual)"}
            </span>
          </li>
        ))}
      </ul>
      <SectionLabel>Alterações</SectionLabel>
      <ol className="relative space-y-3 border-l border-gray-200 pl-4 dark:border-gray-800">
        {events.map((e, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 dark:border-gray-900" />
            <p className="text-theme-xs text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{e.userName}</span> · {formatDateTime(e.at)}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {e.lines.map((line, j) => {
                const ref = e.refs?.[j];
                return (
                  <li key={j} className="break-words text-theme-sm text-gray-700 dark:text-gray-300">
                    {ref ? (
                      <button
                        type="button"
                        title={REF_TITLE[ref.kind]}
                        className="text-left text-brand-600 hover:underline dark:text-brand-400"
                        onClick={() => onOpen(ref)}
                      >
                        {line}
                      </button>
                    ) : (
                      line
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {events.length === 0 && <li className="text-theme-sm text-gray-400">Nenhuma alteração registrada.</li>}
      </ol>
    </div>
  );
}
