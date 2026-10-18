// Formulários "Nova negociação" (comercial), "Novo ticket" (operacional) e
// "Nova etapa" (projeto) - spec 01, seções 4, 5 e 5.1.
import { useEffect, useMemo, useRef, useState } from "react";
import { PlusCircle } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, TaTextarea } from "@tailadmin";
import { call } from "../../rpc/client";
import type { CustomField, CustomValue } from "../../db/customFields";
import type { Pipeline, PipelineType, Stage } from "../../db/pipelines";
import { CARD_TEXT } from "../../lib/cardTypes";
import { formatCents, fromDateInput } from "../../lib/format";
import { useSession } from "../session";
import { Combobox, type ComboItem } from "../ui/Combobox";
import { CustomFieldsForm, isProminent } from "../ui/CustomFieldsForm";
import { ErrorText, Field, SectionLabel } from "../ui/form";
import { MoneyInput } from "../ui/MoneyInput";
import { SimilarNotice, useSimilar } from "../ui/SimilarNotice";
import { SlaPicker } from "../ui/SlaPicker";
import { StageSelect } from "../ui/StageSelect";
import { TagPicker } from "../ui/TagPicker";
import { UserSelect } from "../ui/UserSelect";
import { ItemsEditor, itemTotal, type ItemDraft } from "./ItemsEditor";
import { createOrganizationQuick, createPersonQuick, searchOrganizations, searchPersons } from "./searchers";
import { errorText } from "../../lib/errors";

export interface CardFormRequest {
  type: PipelineType;
  pipelineId?: string;
  stageId?: string;
  /** Pré-preenchimento (popup do WhatsApp: contato da conversa aberta). */
  person?: ComboItem | null;
  title?: string;
  origin?: string;
}

export function CardFormModal({
  request,
  pipelines,
  onClose,
  onCreated,
  onOpenExisting,
  openExistingLabel = "Abrir",
}: {
  request: CardFormRequest | null;
  pipelines: Pipeline[];
  onClose: () => void;
  /** `open` = botão "Criar e abrir". */
  onCreated: (id: string, pipelineId: string, open: boolean) => void;
  /** Cartão parecido já existente (anti-duplicidade). */
  onOpenExisting?: (id: string, pipelineId: string) => void;
  openExistingLabel?: string;
}) {
  const { user } = useSession();
  const type = request?.type ?? "comercial";
  const text = CARD_TEXT[type];
  const options = useMemo(() => pipelines.filter((p) => p.type === type), [pipelines, type]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [valueCents, setValueCents] = useState(0);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [pipelineId, setPipelineId] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState<string | null>(null);
  const [slaAt, setSlaAt] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [person, setPerson] = useState<ComboItem | null>(null);
  const [org, setOrg] = useState<ComboItem | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(user.id);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, CustomValue>>({});
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingOpen = useRef(false);
  const [saving, setSaving] = useState(false);
  // Título parecido no mesmo tipo, ou cartão em aberto do mesmo contato/organização.
  const similar = useSimilar(
    `${type}|${title}|${person?.id}|${org?.id}`,
    () => call("similar.cards", { title, kind: text.kind, personId: person?.id, organizationId: org?.id }),
    request !== null && (title.trim().length >= 3 || !!person || !!org),
  );

  // Reinicia ao abrir.
  useEffect(() => {
    if (!request) return;
    setTitle(request.title ?? "");
    setDescription("");
    setValueCents(0);
    setItems([]);
    setSlaAt(null);
    setStartDate("");
    setDueDate("");
    setPerson(null);
    setOrg(null);
    if (request.person) void pickPerson(request.person);
    setOwnerId(user.id);
    setTagIds([]);
    setCustomValues({});
    setShowMore(false);
    setError(null);
    setPipelineId(request.pipelineId && options.some((p) => p.id === request.pipelineId) ? request.pipelineId : (options[0]?.id ?? ""));
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  // Etapas e campos personalizados do funil escolhido.
  useEffect(() => {
    if (!request || !pipelineId) return;
    void call("stages.list", { pipelineId }).then((list) => {
      setStages(list);
      setStageId(request.stageId && list.some((s) => s.id === request.stageId) ? request.stageId : (list[0]?.id ?? null));
    });
    void call("customFields.list", { entity: text.kind, pipelineId }).then(setFields);
  }, [request, pipelineId, text.kind]);

  // Ao escolher o contato, sugere a organização principal dele (spec 04).
  const pickPerson = async (item: ComboItem | null) => {
    setPerson(item);
    if (item && !org) {
      const detail = await call("persons.get", { id: item.id });
      const primary = detail?.organizations.find((o) => o.is_primary);
      if (primary) setOrg({ id: primary.id, label: primary.name });
    }
  };

  async function submit(open: boolean, force = false) {
    if (!force && !(await similar.confirm())) {
      pendingOpen.current = open;
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await call("cards.create", {
        pipelineId,
        stageId: stageId ?? undefined,
        title,
        description: type === "comercial" ? undefined : description,
        valueCents: items.length === 0 && valueCents ? valueCents : undefined,
        items: items.length ? items : undefined,
        slaAt: type === "operacional" ? slaAt : undefined,
        startAt: type === "projeto" ? fromDateInput(startDate) : undefined,
        dueAt: type === "projeto" ? fromDateInput(dueDate) : undefined,
        personId: person?.id ?? null,
        organizationId: org?.id ?? null,
        ownerId,
        tagIds,
        customValues,
        origin: request?.origin,
      });
      onCreated(id, pipelineId, open);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const itemsSum = items.reduce((acc, i) => acc + itemTotal(i), 0);

  return (
    <TaModal isOpen={request !== null} onClose={onClose} title={text.newTitle} width="max-w-xl">
      <Field label={text.titleLabel} required>
        <TaInput autoFocus value={title} placeholder={text.titlePlaceholder} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      {/* Valor e produtos/serviços em todos os tipos de funil. */}
      {
        <>
          <SectionLabel>Valor</SectionLabel>
          <div className="flex items-center gap-3">
            <div className="w-1/2">
              {items.length ? (
                <div className="flex h-10 items-center rounded-lg bg-gray-50 px-3.5 text-theme-sm text-gray-800 dark:bg-white/5 dark:text-white/90">
                  {formatCents(itemsSum)}
                </div>
              ) : (
                <MoneyInput value={valueCents} onChange={setValueCents} />
              )}
            </div>
            <button
              type="button"
              className="flex items-center gap-1.5 text-theme-sm font-medium text-brand-600 hover:underline"
              onClick={() => setItemsOpen(true)}
            >
              <PlusCircle size={16} />
              {items.length ? `${items.length} produto(s) — editar` : "Adicionar"}
            </button>
          </div>
        </>
      }

      {type === "operacional" && (
        <>
          <SectionLabel>Ticket</SectionLabel>
          <Field label="Descrição">
            <TaTextarea
              rows={3}
              placeholder="Descreva o problema, solicitação ou contexto do ticket"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="SLA">
            <SlaPicker value={slaAt} onChange={setSlaAt} />
          </Field>
        </>
      )}

      {type === "projeto" && (
        <>
          <SectionLabel>Projeto</SectionLabel>
          <Field label="Descrição">
            <TaTextarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início">
              <TaInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Prazo">
              <TaInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
        </>
      )}

      <SectionLabel>{text.pipelineSection}</SectionLabel>
      <Field label="Funil" className="[&>span]:sr-only">
        <TaSelect value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </TaSelect>
      </Field>
      <Field label={text.stageLabel} required>
        <StageSelect stages={stages} value={stageId} onChange={setStageId} />
      </Field>

      <SectionLabel>Relacionamento</SectionLabel>
      <Field label="Contato">
        <Combobox
          value={person}
          onChange={(i) => void pickPerson(i)}
          search={searchPersons}
          placeholder="Buscar por nome, telefone ou e-mail"
          onCreate={createPersonQuick}
          createLabel="Criar contato"
        />
      </Field>
      <div className="mb-3">
        <span className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">
          Organização <span className="font-normal text-gray-400">(opcional)</span>
        </span>
        <Combobox
          value={org}
          onChange={setOrg}
          search={searchOrganizations}
          placeholder="Buscar organização"
          onCreate={createOrganizationQuick}
          createLabel="Criar organização"
          dashed={
            <>
              <PlusCircle size={15} /> Vincular ou criar organização
            </>
          }
        />
      </div>

      <SimilarNotice
        state={similar}
        openLabel={openExistingLabel}
        onOpen={onOpenExisting && ((c) => onOpenExisting(c.id, c.pipeline_id))}
        onContinue={() => void submit(pendingOpen.current, true)}
        reasonText={(c) =>
          c.reason === "person" ? "Mesmo contato, em aberto" : c.reason === "organization" ? "Mesma organização, em aberto" : `${c.score}% parecido`
        }
      />

      {/* "Sempre mostrar" e obrigatórios ficam fora de "Mais detalhes" (spec 01, P2). */}
      {fields.some((f) => !f.hidden && isProminent(f)) && (
        <CustomFieldsForm fields={fields.filter(isProminent)} values={customValues} onChange={setCustomValues} />
      )}
      {showMore ? (
        <>
          <SectionLabel>Mais detalhes</SectionLabel>
          <Field label="Responsável">
            <UserSelect value={ownerId} onChange={setOwnerId} />
          </Field>
          <Field label="Tags">
            <TagPicker entity={text.kind} value={tagIds} onChange={setTagIds} />
          </Field>
          <CustomFieldsForm fields={fields.filter((f) => !isProminent(f))} values={customValues} onChange={setCustomValues} />
        </>
      ) : (
        <button
          type="button"
          className="mt-2 flex items-center gap-1.5 text-theme-sm font-medium text-brand-600 hover:underline"
          onClick={() => setShowMore(true)}
        >
          <PlusCircle size={16} /> Mais detalhes (responsável, tags e campos personalizados)
        </button>
      )}

      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex gap-2">
        <TaButton disabled={saving || !pipelineId} onClick={() => void submit(true)}>
          Criar e abrir
        </TaButton>
        <TaButton variant="primary" disabled={saving || !pipelineId} onClick={() => void submit(false)}>
          Criar
        </TaButton>
      </div>

      <ItemsEditor
        open={itemsOpen}
        items={items}
        onClose={() => setItemsOpen(false)}
        onSave={(list) => {
          setItems(list);
          setItemsOpen(false);
        }}
      />
    </TaModal>
  );
}
