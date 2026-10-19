// Barra de ações em lote (spec 01, seção 10.1.3): aparece no lugar da barra
// de ferramentas quando há cartões selecionados no quadro ou na lista.
// Mover de etapa, mudar de funil/categoria, responsável, ganho/perdido/
// reabrir, tags, atualizar campo, adicionar contato, agendar atividade,
// exportar, arquivar e excluir.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  CalendarPlus,
  ChevronDown,
  Download,
  MoreHorizontal,
  PencilLine,
  RotateCcw,
  Tags,
  Trash2,
  Trophy,
  UserPlus,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { BulkAction, BulkResult } from "../../db/bulkCards";
import type { CustomField, CustomValue } from "../../db/customFields";
import type { BoardCard, BoardColumn } from "../../db/deals";
import type { Pipeline, Stage } from "../../db/pipelines";
import { CARD_TEXT, OUTCOME_TEXT, PIPELINE_TYPE_LABEL, PIPELINE_TYPE_ORDER } from "../../lib/cardTypes";
import { errorText } from "../../lib/errors";
import { formatCents, formatDate, fromDateInput } from "../../lib/format";
import { downloadSpreadsheet } from "../../lib/spreadsheet";
import { useSession } from "../session";
import { Combobox, type ComboItem } from "../ui/Combobox";
import { FieldInput } from "../ui/CustomFieldsForm";
import { Field } from "../ui/form";
import { Popover } from "../ui/Popover";
import { TagPicker } from "../ui/TagPicker";
import { RemindersEditor } from "../ui/RemindersEditor";
import { loadNotifySettings, type ReminderRule } from "../../lib/notify/settings";
import { createPersonQuick, searchPersons } from "../cards/searchers";
import { StagePill } from "../ui/StageSelect";

type Dialog = "pipeline" | "lost" | "addTags" | "removeTags" | "field" | "contact" | "activity" | null;

export function BulkBar({
  pipeline,
  columns,
  selected,
  onClear,
  onSelectAll,
  onDone,
}: {
  pipeline: Pipeline;
  columns: BoardColumn[];
  selected: string[];
  onClear: () => void;
  onSelectAll: () => void;
  /** Recarrega o quadro e mostra o resultado. */
  onDone: (message: string, errors: BulkResult["errors"]) => void;
}) {
  const { user } = useSession();
  const text = CARD_TEXT[pipeline.type];
  const outcome = OUTCOME_TEXT[pipeline.type];
  const [menu, setMenu] = useState<"stage" | "owner" | "more" | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => columns.flatMap((c) => c.cards.map((card) => ({ card, stage: c }))), [columns]);
  const chosen = all.filter((x) => selected.includes(x.card.id));
  const n = chosen.length;
  const plural = n === 1 ? text.noun : `${text.noun}s`;
  const anyArchived = chosen.some((x) => x.card.archived_at);
  const anyOpen = chosen.some((x) => x.card.status === "open");
  const anyClosed = chosen.some((x) => x.card.status !== "open");

  /** Executa e avisa: "3 negócios movidos" (+ os que falharam). */
  async function apply(action: BulkAction, done: string) {
    setBusy(true);
    try {
      const r = await call("cards.bulk", { ids: selected, action });
      setDialog(null);
      setMenu(null);
      // "movidos" → "movido" quando é um só.
      const verb = r.done === 1 ? done.replace(/^(\S+)os\b/u, "$1o") : done;
      onDone(r.done ? `${r.done} ${r.done === 1 ? text.noun : `${text.noun}s`} ${verb}.` : "", r.errors);
    } catch (e) {
      onDone("", [{ id: "", title: "", message: errorText(e) }]);
    } finally {
      setBusy(false);
    }
  }

  function exportExcel() {
    const rows = chosen.map(({ card, stage }) => [
      card.title,
      stage.name,
      card.value_cents / 100,
      card.person_name,
      card.organization_name,
      card.owner_name,
      card.status === "open" ? "Aberto" : card.status === "won" ? outcome.won : outcome.lost,
      formatDate(card.created_at),
      card.closed_at ? formatDate(card.closed_at) : null,
    ]);
    downloadSpreadsheet(
      `${pipeline.name}-selecionados.xlsx`,
      pipeline.name,
      ["Título", "Etapa", "Valor", "Contato", "Organização", "Responsável", "Situação", "Criado em", "Fechado em"],
      rows,
    );
    setMenu(null);
  }

  const btn =
    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm font-medium text-gray-700 hover:bg-white dark:text-gray-200 dark:hover:bg-white/10 disabled:opacity-50";
  const item = "flex w-full items-center gap-2 px-3.5 py-2 text-left text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5";

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-brand-200 bg-brand-25 px-2 py-1.5 dark:border-brand-500/30 dark:bg-brand-500/10"
      data-bulk-bar
    >
      <button
        type="button"
        title="Limpar seleção (Esc)"
        onClick={onClear}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-white dark:hover:bg-white/10"
      >
        <X size={16} />
      </button>
      <span className="mr-1 text-theme-sm font-semibold text-gray-800 dark:text-white/90" data-selected-count={n}>
        {n} {plural} selecionado{n === 1 ? "" : "s"}
      </span>
      {n < all.length && (
        <button type="button" onClick={onSelectAll} className="mr-2 text-theme-sm text-brand-600 hover:underline">
          Selecionar todos ({all.length})
        </button>
      )}
      <span className="mx-1 h-5 w-px bg-brand-200 dark:bg-white/10" />

      <div className="relative">
        <button type="button" className={btn} disabled={busy} onClick={() => setMenu(menu === "stage" ? null : "stage")}>
          Mover para etapa <ChevronDown size={14} />
        </button>
        <Popover open={menu === "stage"} onClose={() => setMenu(null)} className="min-w-[220px] py-1">
          {columns.map((c) => (
            <button key={c.id} type="button" className={item} onClick={() => void apply({ type: "moveStage", stageId: c.id }, `movidos para ${c.name}`)}>
              <StagePill name={c.name} color={c.color} className="min-w-0" />
            </button>
          ))}
        </Popover>
      </div>
      <button type="button" className={btn} disabled={busy} onClick={() => setDialog("pipeline")}>
        <ArrowLeftRight size={15} /> Mudar de funil
      </button>
      <div className="relative">
        <button type="button" className={btn} disabled={busy} onClick={() => setMenu(menu === "owner" ? null : "owner")}>
          <UserRound size={15} /> Responsável <ChevronDown size={14} />
        </button>
        <Popover open={menu === "owner"} onClose={() => setMenu(null)} className="max-h-72 min-w-[220px] overflow-y-auto py-1">
          <OwnerList onPick={(id, name) => void apply({ type: "owner", ownerId: id }, `agora com ${name}`)} />
        </Popover>
      </div>
      {anyOpen && (
        <>
          <button
            type="button"
            className={cn(btn, "text-success-700")}
            disabled={busy}
            onClick={() => void apply({ type: "status", status: "won" }, `marcados como ${outcome.won.toLowerCase()}`)}
          >
            <Trophy size={15} /> {outcome.won}
          </button>
          <button type="button" className={cn(btn, "text-error-600")} disabled={busy} onClick={() => setDialog("lost")}>
            <XCircle size={15} /> {outcome.lost}
          </button>
        </>
      )}
      {anyClosed && (
        <button type="button" className={btn} disabled={busy} onClick={() => void apply({ type: "status", status: "open" }, "reabertos")}>
          <RotateCcw size={15} /> Reabrir
        </button>
      )}
      <div className="relative">
        <button type="button" className={btn} disabled={busy} onClick={() => setMenu(menu === "more" ? null : "more")}>
          <MoreHorizontal size={15} /> Mais <ChevronDown size={14} />
        </button>
        <Popover open={menu === "more"} onClose={() => setMenu(null)} className="left-auto right-0 min-w-[230px] py-1">
          {(
            [
              [<Tags key="t" size={15} />, "Adicionar tags", () => setDialog("addTags")],
              [<Tags key="r" size={15} />, "Remover tags", () => setDialog("removeTags")],
              [<PencilLine key="f" size={15} />, "Atualizar campo", () => setDialog("field")],
              [<UserPlus key="c" size={15} />, "Adicionar contato", () => setDialog("contact")],
              [<CalendarPlus key="a" size={15} />, "Agendar atividade", () => setDialog("activity")],
              [<Download key="e" size={15} />, "Exportar para Excel", exportExcel],
            ] as [ReactNode, string, () => void][]
          ).map(([icon, label, fn]) => (
            <button
              key={label}
              type="button"
              className={item}
              onClick={() => {
                setMenu(null);
                fn();
              }}
            >
              {icon} {label}
            </button>
          ))}
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          {anyArchived ? (
            <button type="button" className={item} onClick={() => void apply({ type: "unarchive" }, "desarquivados")}>
              <ArchiveRestore size={15} /> Desarquivar
            </button>
          ) : (
            <button
              type="button"
              className={item}
              onClick={() =>
                confirm(`Arquivar ${n} ${plural}? Saem do quadro, mas continuam nos relatórios, na busca e na ficha do contato.`) &&
                void apply({ type: "archive" }, "arquivados")
              }
            >
              <Archive size={15} /> Arquivar
            </button>
          )}
          <button
            type="button"
            className={cn(item, "text-error-600")}
            onClick={() => confirm(`Excluir ${n} ${plural}? Vão para a lixeira (com as atividades e notas), de onde podem ser restaurados.`) && void apply({ type: "delete" }, "excluídos")}
          >
            <Trash2 size={15} /> Excluir
          </button>
        </Popover>
      </div>
      {busy && <span className="ml-2 text-theme-xs text-brand-600">Aplicando…</span>}
      <span className="ml-auto pr-1 text-theme-xs text-gray-500">
        {formatCents(chosen.reduce((a, x) => a + x.card.value_cents, 0))} no total{user.role !== "admin" ? " · só os cartões que você pode editar" : ""}
      </span>

      {dialog === "pipeline" && (
        <PipelineDialog pipeline={pipeline} cards={chosen.map((x) => x.card)} busy={busy} onClose={() => setDialog(null)} onApply={apply} />
      )}
      {dialog === "lost" && <LostDialog pipeline={pipeline} n={n} busy={busy} onClose={() => setDialog(null)} onApply={apply} />}
      {(dialog === "addTags" || dialog === "removeTags") && (
        <TagsDialog pipeline={pipeline} remove={dialog === "removeTags"} busy={busy} onClose={() => setDialog(null)} onApply={apply} />
      )}
      {dialog === "field" && <FieldDialog pipeline={pipeline} busy={busy} onClose={() => setDialog(null)} onApply={apply} />}
      {dialog === "contact" && <ContactDialog busy={busy} onClose={() => setDialog(null)} onApply={apply} />}
      {dialog === "activity" && <ActivityDialog busy={busy} n={n} onClose={() => setDialog(null)} onApply={apply} />}
    </div>
  );
}

type ApplyFn = (action: BulkAction, done: string) => Promise<void>;

function OwnerList({ onPick }: { onPick: (id: string | null, name: string) => void }) {
  const { users } = useSession();
  return (
    <>
      {users
        .filter((u) => u.active)
        .map((u) => (
          <button
            key={u.id}
            type="button"
            className="block w-full px-3.5 py-2 text-left text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
            onClick={() => onPick(u.id, u.name)}
          >
            {u.name}
          </button>
        ))}
      <button
        type="button"
        className="block w-full px-3.5 py-2 text-left text-theme-sm text-gray-500 hover:bg-gray-50"
        onClick={() => onPick(null, "sem responsável")}
      >
        Sem responsável
      </button>
    </>
  );
}

function Footer({ busy, onClose, onOk, label, disabled }: { busy: boolean; onClose: () => void; onOk: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <TaButton onClick={onClose}>Cancelar</TaButton>
      <TaButton variant="primary" disabled={busy || disabled} onClick={onOk}>
        {busy ? "Aplicando…" : label}
      </TaButton>
    </div>
  );
}

/** Outro funil, de qualquer categoria: etapa de mesmo nome quando existe; senão a escolhida. */
function PipelineDialog({
  pipeline,
  cards,
  busy,
  onClose,
  onApply,
}: {
  pipeline: Pipeline;
  cards: BoardCard[];
  busy: boolean;
  onClose: () => void;
  onApply: ApplyFn;
}) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [target, setTarget] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState("");
  const [byName, setByName] = useState(true);
  useEffect(() => {
    void call("pipelines.list", {}).then((all) => {
      const list = all.filter((p) => !p.archived_at && p.id !== pipeline.id);
      setPipelines(list);
      setTarget(list[0]?.id ?? "");
    });
  }, [pipeline.id]);
  useEffect(() => {
    if (!target) return;
    void call("stages.list", { pipelineId: target }).then((s) => {
      setStages(s);
      setStageId(s[0]?.id ?? "");
    });
  }, [target]);
  const dest = pipelines.find((p) => p.id === target);
  const typeChange = dest && dest.type !== pipeline.type;
  return (
    <TaModal isOpen onClose={onClose} title={`Mudar ${cards.length} cartão(ões) de funil`} width="max-w-lg">
      <Field label="Funil de destino">
        <TaSelect value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Funil de destino">
          {PIPELINE_TYPE_ORDER.map((t) => {
            const list = pipelines.filter((p) => p.type === t);
            return list.length ? (
              <optgroup key={t} label={PIPELINE_TYPE_LABEL[t]}>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </TaSelect>
      </Field>
      <label className="mb-3 flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={byName} onChange={(e) => setByName(e.target.checked)} />
        Usar a etapa de mesmo nome quando existir no destino
      </label>
      <Field label={byName ? "Etapa para os que não têm etapa de mesmo nome" : "Etapa de destino"}>
        <TaSelect value={stageId} onChange={(e) => setStageId(e.target.value)} aria-label="Etapa de destino">
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </TaSelect>
      </Field>
      {typeChange && (
        <p className="rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800">
          O destino é {PIPELINE_TYPE_LABEL[dest.type].toLowerCase()}: os cartões passam a ser {CARD_TEXT[dest.type].noun}s. Tags e campos de mesmo nome são
          levados.
        </p>
      )}
      <Footer
        busy={busy}
        onClose={onClose}
        label="Mudar de funil"
        disabled={!target || !stageId}
        onOk={() => void onApply({ type: "changePipeline", pipelineId: target, fallbackStageId: stageId, matchByName: byName }, `levados para ${dest?.name}`)}
      />
    </TaModal>
  );
}

function LostDialog({ pipeline, n, busy, onClose, onApply }: { pipeline: Pipeline; n: number; busy: boolean; onClose: () => void; onApply: ApplyFn }) {
  const outcome = OUTCOME_TEXT[pipeline.type];
  const [reasons, setReasons] = useState<{ id: string; name: string; active: number }[]>([]);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    void call("lossReasons.list", {}).then((r) => setReasons(r.filter((x) => x.active)));
  }, []);
  return (
    <TaModal isOpen onClose={onClose} title={`${outcome.markLost} (${n})`} width="max-w-md">
      <Field label={outcome.lossReason}>
        <TaSelect value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="">—</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </TaSelect>
      </Field>
      <Field label={outcome.lossNote}>
        <TaInput value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Footer
        busy={busy}
        onClose={onClose}
        label={outcome.markLost}
        onOk={() =>
          void onApply(
            { type: "status", status: "lost", lossReasonId: reasonId || null, lossNote: note || null },
            `marcados como ${outcome.lost.toLowerCase()}`,
          )
        }
      />
    </TaModal>
  );
}

function TagsDialog({
  pipeline,
  remove,
  busy,
  onClose,
  onApply,
}: {
  pipeline: Pipeline;
  remove: boolean;
  busy: boolean;
  onClose: () => void;
  onApply: ApplyFn;
}) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <TaModal isOpen onClose={onClose} title={remove ? "Remover tags" : "Adicionar tags"} width="max-w-md">
      <Field label="Tags" hint={remove ? "Saem dos cartões selecionados que as tiverem." : "Somadas às tags que os cartões já têm."}>
        <TagPicker entity={CARD_TEXT[pipeline.type].kind} value={ids} onChange={setIds} />
      </Field>
      <Footer
        busy={busy}
        onClose={onClose}
        label={remove ? "Remover" : "Adicionar"}
        disabled={!ids.length}
        onOk={() => void onApply(remove ? { type: "removeTags", tagIds: ids } : { type: "addTags", tagIds: ids }, remove ? "sem as tags" : "com as tags")}
      />
    </TaModal>
  );
}

/** Atualizar um campo em todos: data do tipo, origem ou campo personalizado do funil. */
function FieldDialog({ pipeline, busy, onClose, onApply }: { pipeline: Pipeline; busy: boolean; onClose: () => void; onApply: ApplyFn }) {
  const kind = CARD_TEXT[pipeline.type].kind;
  const standard: { key: string; label: string; date: boolean }[] = [
    ...(kind === "deal" ? [{ key: "expectedCloseAt", label: "Previsão de fechamento", date: true }] : []),
    ...(kind === "ticket" ? [{ key: "slaAt", label: "SLA", date: true }] : []),
    ...(kind === "project"
      ? [
          { key: "startAt", label: "Início", date: true },
          { key: "dueAt", label: "Prazo", date: true },
        ]
      : []),
    { key: "origin", label: "Origem", date: false },
  ];
  const [fields, setFields] = useState<CustomField[]>([]);
  const [key, setKey] = useState(standard[0]!.key);
  const [value, setValue] = useState("");
  const [custom, setCustom] = useState<CustomValue>(null);
  useEffect(() => {
    void call("customFields.list", { entity: kind, pipelineId: pipeline.id }).then((f) => setFields(f.filter((x) => x.field_type !== "document")));
  }, [kind, pipeline.id]);
  const cf = key.startsWith("cf:") ? fields.find((f) => `cf:${f.id}` === key) : undefined;
  const std = standard.find((s) => s.key === key);
  return (
    <TaModal isOpen onClose={onClose} title="Atualizar campo" width="max-w-md">
      <Field label="Campo">
        <TaSelect
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setValue("");
            setCustom(null);
          }}
          aria-label="Campo a atualizar"
        >
          {standard.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
          {fields.length > 0 && (
            <optgroup label="Campos personalizados">
              {fields.map((f) => (
                <option key={f.id} value={`cf:${f.id}`}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          )}
        </TaSelect>
      </Field>
      <Field label="Novo valor" hint="Em branco apaga o valor nos cartões selecionados.">
        {cf ? (
          <FieldInput field={cf} value={custom ?? undefined} onChange={setCustom} />
        ) : (
          <TaInput type={std?.date ? "date" : "text"} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Novo valor" />
        )}
      </Field>
      <Footer
        busy={busy}
        onClose={onClose}
        label="Atualizar"
        onOk={() =>
          void onApply(
            cf
              ? { type: "setCustom", fieldId: cf.id, value: custom }
              : { type: "setField", field: key as "origin", value: std?.date ? fromDateInput(value) : value || null },
            `com ${cf?.name ?? std?.label} atualizado`,
          )
        }
      />
    </TaModal>
  );
}

function ContactDialog({ busy, onClose, onApply }: { busy: boolean; onClose: () => void; onApply: ApplyFn }) {
  const [person, setPerson] = useState<ComboItem | null>(null);
  return (
    <TaModal isOpen onClose={onClose} title="Adicionar contato aos cartões" width="max-w-md">
      <Field label="Contato" hint="Entra como contato principal onde não houver; nos demais, em “outros contatos”.">
        <Combobox
          value={person}
          onChange={setPerson}
          search={searchPersons}
          placeholder="Buscar por nome, telefone ou e-mail"
          onCreate={createPersonQuick}
          createLabel="Criar contato"
        />
      </Field>
      <Footer
        busy={busy}
        onClose={onClose}
        label="Adicionar"
        disabled={!person}
        onOk={() => void onApply({ type: "addContact", personId: person!.id }, `com ${person!.label}`)}
      />
    </TaModal>
  );
}

/** A mesma atividade em cada cartão (ex.: follow-up de uma campanha). */
function ActivityDialog({ busy, n, onClose, onApply }: { busy: boolean; n: number; onClose: () => void; onApply: ApplyFn }) {
  const [types, setTypes] = useState<{ id: string; name: string; active: number }[]>([]);
  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const tomorrow = new Date(Date.now() + 86400000);
  const [date, setDate] = useState(
    `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`,
  );
  const [time, setTime] = useState("09:00");
  const [ownerFromCard, setOwnerFromCard] = useState(true);
  const { user } = useSession();
  const [reminders, setReminders] = useState<ReminderRule[]>([]);
  useEffect(() => {
    void loadNotifySettings(user.id).then((n) => setReminders(n.defaults));
  }, [user.id]);
  useEffect(() => {
    void call("activityTypes.list", {}).then((t) => {
      const list = t.filter((x) => x.active);
      setTypes(list);
      setTypeId(list[0]?.id ?? "");
    });
  }, []);
  const dueAt = date ? new Date(`${date}T${time || "09:00"}:00`).toISOString() : "";
  return (
    <TaModal isOpen onClose={onClose} title={`Agendar atividade em ${n} cartão(ões)`} width="max-w-md">
      <Field label="Tipo">
        <TaSelect value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </TaSelect>
      </Field>
      <Field label="Título" required>
        <TaInput value={title} placeholder="Ex.: Retomar contato" onChange={(e) => setTitle(e.target.value)} aria-label="Título da atividade" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data">
          <TaInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Hora">
          <TaInput type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={ownerFromCard} onChange={(e) => setOwnerFromCard(e.target.checked)} />
        Para o responsável de cada cartão (desmarcado: para mim)
      </label>
      <div className="mt-3">
        <Field label="Lembretes">
          <RemindersEditor compact value={reminders} onChange={setReminders} />
        </Field>
      </div>
      <Footer
        busy={busy}
        onClose={onClose}
        label="Agendar"
        disabled={!title.trim() || !dueAt}
        onOk={() => void onApply({ type: "activity", typeId: typeId || undefined, title: title.trim(), dueAt, ownerFromCard, reminders }, "com a atividade agendada")}
      />
    </TaModal>
  );
}
