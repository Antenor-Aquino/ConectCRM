// Modal de tarefa (spec 02, mockup): esquerda = concluir + nome + descrição,
// campos personalizados e anexos; direita = Tipo, Responsável, Início
// (duração/lembrete), Finalização (opcional), Vinculado a e Tags.
// Tipos de reunião podem criar o evento no Google Agenda / Outlook.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Circle, Link2, MessageCircle, Minus, Paperclip, Pencil, Trash2, Video, X } from "lucide-react";
import { TaButton, TaInput, TaModal, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Activity, ActivityType } from "../../db/activities";
import type { CustomField, CustomValue } from "../../db/customFields";
import { ActivityIcon } from "../../lib/activityIcons";
import { busyRanges, calendarConnected, computeFreeSlots, connectCalendar, createCalendarEvent, PROVIDER_LABEL, type CalendarProvider } from "../../lib/calendar";
import { isValidEmail } from "../../lib/validate";
import { useSession } from "../session";
import { Avatar } from "../ui/Avatar";
import { Combobox, type ComboItem } from "../ui/Combobox";
import { CustomFieldsForm } from "../ui/CustomFieldsForm";
import { ErrorText, Field } from "../ui/form";
import { Popover } from "../ui/Popover";
import { EndPicker, WhenPicker } from "./WhenPicker";
import { TagPicker } from "../ui/TagPicker";
import { formatBytes, MAX_UPLOAD_BYTES } from "../../lib/files";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { UploadModal } from "../documents/UploadModal";
import { errorText } from "../../lib/errors";
import { ACTIVE_CHANNELS, CHANNEL_LABEL, activeSettings, channelReady, loadNotifySettings, type Channel, type NotifySettings, type ReminderRule } from "../../lib/notify/settings";
import { formatDateTime } from "../../lib/format";
import { RemindersEditor } from "../ui/RemindersEditor";
import { ContactTemplateEditor } from "../ui/ContactTemplateEditor";
import { Switch } from "../ui/Switch";
import { UnsavedDialog, useDraft } from "../ui/unsaved";
import { CONTACT_MINUTES_OPTIONS, leadText } from "../../lib/notify/contactMessage";
import { loadSenders, type WhatsAppSender } from "../../lib/whatsappSenders";
import { LinkedTextarea } from "../ui/LinkedTextarea";
import { RecurrenceEditor, ScopeDialog, type Scope } from "./RecurrenceEditor";
import { describeRule, type RecurrenceRule } from "../../lib/recurrence";
import { Repeat } from "lucide-react";

const KIND_LABEL = { deal: "Negócio", ticket: "Ticket", project: "Projeto" } as const;

export interface TaskRequest {
  /** Editar uma tarefa existente. */
  id?: string;
  dealId?: string;
  personId?: string;
  organizationId?: string;
  /** Já abre como reunião (popup do WhatsApp → "Agendar reunião"). */
  meeting?: boolean;
}

async function searchCards(text: string): Promise<ComboItem[]> {
  const list = await call("cards.search", { search: text });
  return list.map((c) => ({ id: c.id, label: c.title, sublabel: `${KIND_LABEL[c.kind]} · ${c.pipeline_name}${c.person_name ? ` · ${c.person_name}` : ""}` }));
}

function TypePicker({ types, value, onChange }: { types: ActivityType[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = types.find((t) => t.id === value);
  const list = types.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 text-left text-theme-sm shadow-theme-xs dark:border-gray-700 dark:bg-gray-900">
        {current && <ActivityIcon name={current.icon} className="text-brand-500" />}
        <span className="flex-1 text-gray-800 dark:text-white/90">{current?.name ?? "Tipo"}</span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-full py-1">
        <div className="relative px-2 pb-1 pt-1">
          <TaInput autoFocus placeholder="Buscar tipo" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button type="button" className="absolute right-4 top-3.5 text-gray-400" onClick={() => setQ("")}>
              <X size={14} />
            </button>
          )}
        </div>
        {list.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              onChange(t.id);
              setOpen(false);
              setQ("");
            }}
            className={cn("flex w-full items-center gap-3 px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5", t.id === value ? "bg-brand-50 font-semibold dark:bg-brand-500/15" : "text-gray-700 dark:text-gray-300")}
          >
            <ActivityIcon name={t.icon} className="text-brand-500" />
            {t.name}
          </button>
        ))}
      </Popover>
    </div>
  );
}

function GuestsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const valid = parts.filter(isValidEmail);
    if (valid.length) onChange([...new Set([...value, ...valid])]);
    setText(parts.filter((p) => !isValidEmail(p)).join(" "));
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-gray-300 px-2 py-1.5 dark:border-gray-700">
      {value.map((g) => (
        <span key={g} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-theme-xs text-brand-700">
          {g}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== g))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="min-w-[160px] flex-1 border-none bg-transparent text-theme-sm outline-none"
        placeholder="e-mail do convidado"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}

export function TaskModal({
  request,
  onClose,
  onSaved,
  minimized = false,
  onMinimizedChange,
}: {
  request: TaskRequest;
  onClose: () => void;
  onSaved: () => void;
  /** Minimizada: some da frente (para consultar o cartão) mas o que foi digitado continua aqui. */
  minimized?: boolean;
  /** Se informado, mostra o botão Minimizar. */
  onMinimizedChange?: (minimized: boolean) => void;
}) {
  const { user, users, label } = useSession();
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [loaded, setLoaded] = useState(!request.id);
  const [existing, setExisting] = useState<Activity | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [done, setDone] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(user.id);
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  });
  const [endAt, setEndAt] = useState<Date | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  /** Arquivos escolhidos antes de salvar uma tarefa nova. */
  const [pending, setPending] = useState<File[]>([]);
  const [uploadAfter, setUploadAfter] = useState<{ taskId: string; files: File[] } | null>(null);
  const [duration, setDuration] = useState(5);
  const [reminders, setReminders] = useState<ReminderRule[]>([]);
  const [notify, setNotify] = useState<NotifySettings | null>(null);
  const [deliveries, setDeliveries] = useState<Awaited<ReturnType<typeof call<"notifications.forActivity">>>>([]);
  const [link, setLink] = useState<ComboItem | null>(null);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, CustomValue>>({});
  // Reunião
  const [makeEvent, setMakeEvent] = useState(false);
  const [provider, setProvider] = useState<CalendarProvider>(() => {
    try {
      return (localStorage.getItem("conectcrm-calendar") as CalendarProvider | null) ?? "google";
    } catch {
      return "google";
    }
  });
  const [connected, setConnected] = useState(false);
  const [guests, setGuests] = useState<string[]>([]);
  const [online, setOnline] = useState(true);
  const [slots, setSlots] = useState<Date[] | null>(null);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Recorrência: a regra (null = não repete), a série da atividade aberta e a pergunta "só esta / próximas / todas".
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [series, setSeries] = useState<{ id: string; rule: RecurrenceRule; startAt: string; index: number } | null>(null);
  const [askScope, setAskScope] = useState<"save" | "delete" | null>(null);
  // Lembrete para o contato por WhatsApp (0.2.69).
  const [meetingUrl, setMeetingUrl] = useState("");
  const [contactOn, setContactOn] = useState(false);
  const [contact, setContact] = useState<{ personId: string; minutesBefore: number; template: string; senderId: string | null }>({
    personId: "",
    minutesBefore: 60,
    template: "",
    senderId: null,
  });
  const [contactCtx, setContactCtx] = useState<Awaited<ReturnType<typeof call<"contactMessages.context">>> | null>(null);
  const [autoSenders, setAutoSenders] = useState<WhatsAppSender[]>([]);

  useEffect(() => {
    void call("activityTypes.list", {}).then((list) => {
      setTypes(list);
      const preferred = request.meeting ? list.find((t) => t.is_meeting) : list.find((t) => t.name === "Tarefa");
      setTypeId((cur) => cur || (preferred ?? list[0])?.id || "");
      if (request.meeting && !request.id) {
        setDuration(60);
        setWhen(() => {
          const d = new Date();
          d.setHours(d.getHours() + 1, 0, 0, 0);
          return d;
        });
      }
    });
    void call("customFields.list", { entity: "activity" }).then(setFields);
    void loadNotifySettings(user.id).then((n) => {
      setNotify(activeSettings(n));
      if (!request.id) setReminders(n.defaults);
      setContact((c) => (c.template ? c : { ...c, template: n.contact.template, minutesBefore: n.contact.minutes, senderId: n.contact.senderId }));
    });
    void loadSenders(user.id).then((r) => setAutoSenders(r.senders.filter((x) => x.via === "zapi" || x.via === "web")));
    if (request.dealId) {
      void call("cards.get", { id: request.dealId }).then((c) => c && setLink({ id: c.id, label: c.title }));
    }
    if (!request.id) return;
    void call("activities.get", { id: request.id }).then(async (a) => {
      if (!a) return;
      setExisting(a);
      setTitle(a.title);
      setDescription(a.description ?? "");
      setDone(!!a.done);
      setTypeId(a.type_id);
      setOwnerId(a.owner_id);
      setWhen(new Date(a.due_at));
      setEndAt(a.end_at ? new Date(a.end_at) : null);
      setTagIds(a.tagIds);
      setDuration(a.duration_min);
      setReminders(a.reminders);
      void call("notifications.forActivity", { id: a.id }).then(setDeliveries);
      if (a.series_id) {
        const s = await call("activities.series", { id: a.id });
        if (s) {
          setSeries({ id: s.id, rule: s.rule, startAt: s.startAt, index: s.index });
          setRecurrence(s.rule);
        }
      }
      setValues(a.customValues);
      setGuests(a.guests ? (JSON.parse(a.guests) as string[]) : []);
      setMeetingUrl(a.meeting_url ?? "");
      if (a.deal_id) {
        const c = await call("cards.get", { id: a.deal_id });
        if (c) setLink({ id: c.id, label: c.title });
      }
      setLoaded(true);
    });
  }, [request]);

  const type = types.find((t) => t.id === typeId);
  // Tarefa nova: o nome começa com o tipo ("Reunião ") para o usuário completar.
  // Trocar o tipo troca só esse começo; nome reescrito pelo usuário não muda.
  const titlePrefix = useRef("");
  useEffect(() => {
    if (request.id || !type) return;
    const next = `${type.name} `;
    const prev = titlePrefix.current;
    setTitle((cur) => {
      if (!cur.trim() || cur.trim() === prev.trim()) return next;
      if (prev && cur.startsWith(prev)) return next + cur.slice(prev.length);
      return cur;
    });
    titlePrefix.current = next;
  }, [type, request.id]);
  const isMeeting = !!type?.is_meeting && !existing?.external_event_id;

  useEffect(() => {
    if (!isMeeting) return;
    void calendarConnected(provider).then((c) => {
      setConnected(c);
      setMakeEvent(c);
    });
    setSlots(null);
  }, [isMeeting, provider]);

  // Convidado sugerido: e-mail do contato do cartão vinculado.
  useEffect(() => {
    if (!isMeeting || !link || guests.length) return;
    void call("cards.get", { id: link.id }).then(async (c) => {
      if (!c?.person_id) return;
      const p = await call("persons.get", { id: c.person_id });
      if (p?.email) setGuests((g) => (g.length ? g : [p.email!]));
    });
  }, [isMeeting, link]); // eslint-disable-line react-hooks/exhaustive-deps

  const owner = useMemo(() => users.find((u) => u.id === ownerId), [users, ownerId]);

  // Quem pode receber o lembrete (contato da atividade e do cartão), empresa do funil e o lembrete salvo.
  const personForContact = request.personId ?? existing?.person_id ?? null;
  useEffect(() => {
    if (!loaded) return;
    void call("contactMessages.context", { activityId: request.id ?? null, personId: personForContact, dealId: link?.id ?? null }).then((c) => {
      setContactCtx(c);
      if (c.current) {
        setContactOn(true);
        setContact({ personId: c.current.person_id, minutesBefore: c.current.minutes_before, template: c.current.template, senderId: c.current.sender_id });
      } else {
        setContact((x) => (x.personId && c.recipients.some((r) => r.id === x.personId) ? x : { ...x, personId: c.recipients.find((r) => r.phone)?.id ?? c.recipients[0]?.id ?? "" }));
      }
    });
  }, [loaded, link?.id, personForContact, request.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const contactSent = contactCtx?.current?.status === "sent";
  const recipient = contactCtx?.recipients.find((r) => r.id === contact.personId) ?? null;
  const withPhone = contactCtx?.recipients.filter((r) => r.phone) ?? [];

  async function findSlots() {
    setCalMsg(null);
    try {
      const { dayStart, dayEnd, busy } = await busyRanges(provider, when);
      setSlots(computeFreeSlots(dayStart, dayEnd, busy, Math.max(duration, 15)));
    } catch (e) {
      setCalMsg(errorText(e));
    }
  }

  // Rascunho: o que o usuário mexeu e ainda não salvou. Compara com o estado já carregado (sem contar o
  // que a tela preenche sozinha) e também registra qualquer digitação/seleção feita no formulário.
  const snap = JSON.stringify([
    title,
    description,
    done,
    typeId,
    ownerId,
    when.getTime(),
    endAt?.getTime() ?? null,
    tagIds,
    duration,
    reminders,
    values,
    meetingUrl,
    recurrence,
    pending.map((f) => `${f.name}:${f.size}`),
  ]);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    if (baseline !== null || !loaded || !types.length || !notify) return;
    const t = setTimeout(() => setBaseline(snap), 600);
    return () => clearTimeout(t);
  }, [baseline, loaded, types.length, notify, snap]);
  const dirty = touched || (baseline !== null && snap !== baseline);
  const draftLabel = request.id ? `Edição da atividade “${title.trim() || "sem nome"}”` : `Atividade nova${title.trim() ? ` “${title.trim()}”` : ""}`;
  useDraft(draftLabel, dirty, "tarefas");
  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  const ruleChanged = !!series && JSON.stringify(recurrence) !== JSON.stringify(series.rule);
  const dateChanged = !!existing && new Date(existing.due_at).getTime() !== when.getTime();

  async function save(scope?: Scope) {
    // Ocorrência de série: pergunta antes se vale para esta, as próximas ou todas.
    if (series && !scope) {
      if (!recurrence) {
        setError("Para parar de repetir, use “Encerrar série” (abaixo do campo Repetir).");
        return;
      }
      setAskScope("save");
      return;
    }
    setAskScope(null);
    setSaving(true);
    setError(null);
    const input = {
      title,
      description,
      typeId,
      ownerId,
      dueAt: when.toISOString(),
      endAt: endAt ? endAt.toISOString() : null,
      tagIds,
      durationMin: duration,
      reminders,
      done,
      dealId: link?.id ?? null,
      ...(request.personId && !link ? { personId: request.personId } : {}),
      ...(request.organizationId && !link ? { organizationId: request.organizationId } : {}),
      customValues: values,
      meetingUrl: meetingUrl.trim() || null,
    };
    if (contactOn && !contactSent) {
      if (!recipient?.phone) {
        setError("Para lembrar o contato pelo WhatsApp, escolha um contato com celular cadastrado.");
        setSaving(false);
        return;
      }
      if (!contact.senderId) {
        setError("Escolha por qual número o lembrete do contato vai sair (Z-API ou WhatsApp Web).");
        setSaving(false);
        return;
      }
    }
    const contactMessage = contactSent ? undefined : contactOn ? contact : contactCtx?.current ? null : undefined;
    if (endAt && endAt < when) {
      setError("A finalização não pode ser antes do início.");
      setSaving(false);
      return;
    }
    let id = request.id;
    try {
      if (id) {
        await call("activities.update", {
          id,
          patch: input,
          ...(contactMessage !== undefined ? { contactMessage } : {}),
          ...(series ? { scope: scope ?? "this", ...(ruleChanged ? { recurrence } : {}) } : recurrence ? { recurrence } : {}),
        });
      } else id = await call("activities.create", { ...input, recurrence, ...(contactMessage ? { contactMessage } : {}) });
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
      return;
    }
    if (isMeeting && makeEvent && !recurrence) {
      try {
        const ev = await createCalendarEvent(provider, {
          title,
          description,
          start: when,
          end: new Date(when.getTime() + Math.max(duration, 15) * 60_000),
          guests,
          online,
          reminderMin: popupLead(reminders),
          emailReminders: notify?.calendarEmailBackup ? reminders.filter((r) => r.channels.includes("email")).map((r) => r.minutesBefore) : [],
        });
        await call("activities.setExternalEvent", { id, provider, eventId: ev.id, meetingUrl: ev.link, guests });
      } catch (e) {
        setSaving(false);
        setError(`Atividade salva, mas o evento não foi criado na agenda: ${errorText(e)}`);
        return;
      }
    }
    setSaving(false);
    // Arquivos escolhidos na tarefa nova: a janela Novo documento abre agora,
    // já vinculada à tarefa (e ao cartão, contato e organização dela).
    if (pending.length && id) setUploadAfter({ taskId: id, files: pending });
    else onSaved();
  }

  if (uploadAfter) {
    return <UploadModal files={uploadAfter.files} context={{ type: "activity", id: uploadAfter.taskId }} onClose={onSaved} onSaved={onSaved} />;
  }

  return (
    <>
    <TaModal
      isOpen={!minimized}
      onClose={requestClose}
      title={request.id ? (series ? "Editar atividade recorrente" : "Editar atividade") : "Nova atividade"}
      width="max-w-3xl"
      headerExtra={
        onMinimizedChange && (
          <button
            type="button"
            onClick={() => onMinimizedChange(true)}
            title="Minimizar: continua com o que você digitou e libera o cartão para consulta"
            aria-label="Minimizar"
            data-task-minimize
            className="text-white/90 hover:text-white"
          >
            <Minus size={20} />
          </button>
        )
      }
    >
      <div onInputCapture={() => setTouched(true)} onChangeCapture={() => setTouched(true)}>
      {askScope && (
        <ScopeDialog
          action={askScope}
          ruleChanged={askScope === "save" && ruleChanged}
          onClose={() => setAskScope(null)}
          onChoose={async (scope) => {
            if (askScope === "save") return void save(scope);
            setAskScope(null);
            await call("activities.delete", { id: request.id!, scope });
            onSaved();
          }}
        />
      )}
      {series && (
        <p className="-mt-2 mb-3 flex items-center gap-1.5 text-theme-xs text-brand-700 dark:text-brand-300" data-series-banner>
          <Repeat size={13} /> {describeRule(series.rule, new Date(series.startAt))}
        </p>
      )}
      {!loaded ? (
        <p className="text-theme-sm text-gray-500">Carregando…</p>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
            <div>
              <div className="flex items-start gap-3">
                <button type="button" title={done ? "Reabrir" : "Concluir"} onClick={() => setDone(!done)} className={cn("mt-1.5", done ? "text-success-600" : "text-gray-300 hover:text-success-500")}>
                  {done ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success-500 text-white">
                      <Check size={13} />
                    </span>
                  ) : (
                    <Circle size={20} />
                  )}
                </button>
                <input
                  autoFocus={!request.id}
                  className={cn("w-full border-none bg-transparent text-lg font-medium text-gray-800 outline-none placeholder:text-gray-400 dark:text-white/90", done && "line-through opacity-60")}
                  placeholder="Nome da atividade"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <LinkedTextarea
                className="ml-8 mt-2 min-h-[120px] w-[calc(100%-2rem)] resize-y border-none bg-transparent text-theme-sm text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-300"
                placeholder="Adicionar descrição…"
                value={description}
                onChange={setDescription}
              />
              {fields.some((f) => !f.hidden) && (
                <div className="ml-8">
                  <CustomFieldsForm fields={fields} values={values} onChange={setValues} />
                </div>
              )}
              <div className="ml-8 mt-3">
                {request.id ? <DocumentsPanel type="activity" id={request.id} compact /> : <PendingFiles pending={pending} onPending={setPending} />}
              </div>
              {contactOn && (
                <div className="ml-8 mt-4 rounded-xl border border-success-200 bg-success-25 p-3 dark:border-success-500/30 dark:bg-success-500/5" data-contact-card>
                  <p className="mb-2 flex items-center gap-1.5 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                    <MessageCircle size={15} className="text-success-600" /> Mensagem para o contato
                  </p>
                  {contactCtx?.current && contactCtx.current.status !== "pending" && (
                    <p
                      className={cn(
                        "mb-2 rounded-lg px-2.5 py-1.5 text-theme-xs",
                        contactSent ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700",
                      )}
                      data-contact-status
                    >
                      {contactSent
                        ? `Enviada em ${formatDateTime(contactCtx.current.sent_at!)}. Não pode mais ser alterada.`
                        : contactCtx.current.status === "canceled"
                          ? `Cancelada: ${contactCtx.current.error ?? ""}`
                          : `Não enviada: ${contactCtx.current.error ?? ""} Salve de novo para reagendar.`}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-theme-xs text-gray-500">
                      Para
                      <select
                        className="mt-1 h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
                        value={contact.personId}
                        disabled={contactSent}
                        onChange={(e) => setContact({ ...contact, personId: e.target.value })}
                        aria-label="Contato que recebe"
                      >
                        {(contactCtx?.recipients ?? []).map((r) => (
                          <option key={r.id} value={r.id} disabled={!r.phone}>
                            {r.name} {r.phone ? `· ${r.phone}` : "(sem celular)"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-theme-xs text-gray-500">
                      Quando
                      <select
                        className="mt-1 h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
                        value={contact.minutesBefore}
                        disabled={contactSent}
                        onChange={(e) => setContact({ ...contact, minutesBefore: Number(e.target.value) })}
                        aria-label="Quando enviar"
                      >
                        {[...new Set([...CONTACT_MINUTES_OPTIONS, contact.minutesBefore])]
                          .sort((a, b) => a - b)
                          .map((m) => (
                            <option key={m} value={m}>
                              {leadText(m)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="col-span-2 text-theme-xs text-gray-500">
                      Link da reunião
                      <input
                        className="mt-1 h-9 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
                        placeholder="https://meet.google.com/… (opcional)"
                        value={meetingUrl}
                        disabled={contactSent}
                        onChange={(e) => setMeetingUrl(e.target.value)}
                        aria-label="Link da reunião"
                      />
                    </label>
                    <label className="col-span-2 text-theme-xs text-gray-500">
                      Enviar pelo número
                      <select
                        className="mt-1 h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
                        value={contact.senderId ?? ""}
                        disabled={contactSent}
                        onChange={(e) => setContact({ ...contact, senderId: e.target.value || null })}
                        aria-label="Número de origem do lembrete"
                      >
                        <option value="">{autoSenders.length ? "Escolher…" : "Cadastre em Configurações → WhatsApp"}</option>
                        {autoSenders.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({x.via === "zapi" ? "Z-API" : "WhatsApp Web"})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="my-2 text-theme-xs text-gray-600 dark:text-gray-400" data-contact-when>
                    Envio: <b>{formatDateTime(new Date(when.getTime() - contact.minutesBefore * 60_000).toISOString())}</b>
                    {new Date(when.getTime() - contact.minutesBefore * 60_000) < new Date() && !contactSent && " (já passou: sai assim que salvar, se a atividade ainda não tiver começado)"}
                  </p>
                  <ContactTemplateEditor
                    value={contactSent ? (contactCtx?.current?.sent_text ?? contact.template) : contact.template}
                    disabled={contactSent}
                    onChange={(template) => setContact({ ...contact, template })}
                    now={new Date(when.getTime() - contact.minutesBefore * 60_000)}
                    vars={{
                      personName: recipient?.name ?? "contato",
                      start: when,
                      link: meetingUrl.trim() ? (/^https?:\/\//i.test(meetingUrl.trim()) ? meetingUrl.trim() : `https://${meetingUrl.trim()}`) : null,
                      activityTitle: title,
                      myName: owner?.name ?? user.name,
                      company: contactCtx?.company ?? null,
                    }}
                  />
                </div>
              )}
              {existing?.external_event_id && (
                <div className="ml-8 mt-3 rounded-lg bg-brand-25 p-3 text-theme-sm text-gray-700 dark:bg-brand-500/10 dark:text-gray-300">
                  Evento criado no {PROVIDER_LABEL[existing.external_provider === "microsoft" ? "microsoft" : "google"]}.
                  {existing.meeting_url && (
                    <a className="ml-1 inline-flex items-center gap-1 font-medium text-brand-600 hover:underline" href={existing.meeting_url} target="_blank" rel="noopener">
                      <Video size={14} /> Entrar na reunião
                    </a>
                  )}
                </div>
              )}
            </div>

            <div>
              <Field label="Tipo">
                <TypePicker types={types} value={typeId} onChange={setTypeId} />
              </Field>
              <Field label="Responsável">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-2.5">
                    <Avatar name={owner?.name} size={22} />
                  </span>
                  <select
                    className="h-10 w-full appearance-none rounded-lg border border-gray-300 bg-white pl-11 pr-8 text-theme-sm text-gray-800 shadow-theme-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                    value={ownerId ?? ""}
                    onChange={(e) => setOwnerId(e.target.value || null)}
                  >
                    <option value="">Sem responsável</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {label(u)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-gray-400" />
                </div>
              </Field>
              <Field label="Início" hint="Padrão: o momento do cadastro. Pode ser uma data futura.">
                <WhenPicker
                  value={when}
                  duration={duration}
                  hideReminder
                  onChange={(v) => {
                    setWhen(v.when);
                    setDuration(v.duration);
                    setSlots(null);
                  }}
                />
              </Field>
              <Field label="Repetir" hint={series ? `Ocorrência ${series.index > 0 ? `nº ${series.index}` : "avulsa"} de uma série.` : "Opcional: diária, dias úteis, semanal, mensal, anual ou a cada X dias."}>
                <RecurrenceEditor value={recurrence} start={series && !dateChanged ? new Date(series.startAt) : when} onChange={setRecurrence} />
                {series && (
                  <button
                    type="button"
                    className="mt-1.5 text-theme-xs text-brand-600 hover:underline"
                    data-end-series
                    onClick={async () => {
                      const today = new Date();
                      const def = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
                      const v = prompt("Encerrar a série em (dd/mm/aaaa): as ocorrências pendentes depois dessa data saem; as concluídas ficam.", def);
                      const m = v?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                      if (!m) return;
                      const date = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
                      try {
                        const n = await call("activities.endSeries", { id: request.id!, date });
                        alert(`Série encerrada em ${v}. ${n} ocorrência(s) pendente(s) depois dessa data saíram.`);
                        onSaved();
                      } catch (e) {
                        setError(errorText(e));
                      }
                    }}
                  >
                    Encerrar série…
                  </button>
                )}
                {recurrence && isMeeting && (
                  <p className="mt-1 text-theme-xs text-gray-500">Em reuniões recorrentes o evento não é criado no Google Agenda/Outlook.</p>
                )}
              </Field>
              <Field label="Lembretes" hint="Quanto tempo antes do início e por onde avisar.">
                <RemindersEditor
                  value={reminders}
                  onChange={setReminders}
                  compact
                  ready={notify ? (Object.fromEntries(ACTIVE_CHANNELS.map((c) => [c, channelReady(notify, c)])) as Record<Channel, boolean>) : undefined}
                />
                {deliveries.length > 0 && <DeliveryLog list={deliveries} />}
                <div className="mt-3 rounded-lg border border-gray-200 p-2.5 dark:border-gray-800" data-contact-toggle>
                  <label className={cn("flex items-start gap-2.5 text-theme-sm text-gray-700 dark:text-gray-300", !withPhone.length && !contactOn && "opacity-60")}>
                    <Switch checked={contactOn} disabled={(!withPhone.length && !contactOn) || contactSent} onChange={setContactOn} />
                    <span>
                      Lembrar o contato pelo WhatsApp
                      <span className="block text-theme-xs text-gray-500">
                        {contactSent
                          ? "Lembrete já enviado."
                          : withPhone.length
                            ? "Envio automático antes do início, com o Chrome aberto (mesmo com o CRM fechado)."
                            : contactCtx?.recipients.length
                              ? `Cadastre o celular de ${contactCtx.recipients[0]!.name} para usar.`
                              : "Vincule um contato (ou um cartão com contato) para usar."}
                      </span>
                    </span>
                  </label>
                </div>
              </Field>
              <Field label="Finalização" hint="Opcional. Sem finalização, a atividade nunca fica atrasada.">
                <EndPicker value={endAt} start={when} onChange={setEndAt} />
              </Field>
              <Field label="Vinculado a" hint="Opcional: negócio, ticket ou etapa de projeto.">
                <Combobox value={link} onChange={setLink} search={searchCards} placeholder="Buscar negócio, ticket ou projeto" />
              </Field>
              <Field label="Tags">
                <TagPicker entity="activity" value={tagIds} onChange={setTagIds} />
              </Field>

              {isMeeting && (
                <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                  <label className="mb-2 flex items-center gap-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    <input type="checkbox" checked={makeEvent} onChange={(e) => setMakeEvent(e.target.checked)} />
                    Criar evento na agenda
                  </label>
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
                      value={provider}
                      onChange={(e) => {
                        setProvider(e.target.value as CalendarProvider);
                        try {
                          localStorage.setItem("conectcrm-calendar", e.target.value);
                        } catch {
                          /* preferência opcional */
                        }
                      }}
                    >
                      <option value="google">Google Agenda</option>
                      <option value="microsoft">Outlook</option>
                    </select>
                    {connected ? (
                      <span className="text-theme-xs text-success-600">Conectado</span>
                    ) : (
                      <TaButton
                        size="sm"
                        onClick={async () => {
                          setCalMsg(null);
                          try {
                            await connectCalendar(provider);
                            setConnected(true);
                            setMakeEvent(true);
                          } catch (e) {
                            setCalMsg(errorText(e));
                          }
                        }}
                      >
                        Conectar
                      </TaButton>
                    )}
                  </div>
                  {makeEvent && connected && (
                    <>
                      <span className="mb-1 block text-theme-xs font-medium text-gray-600 dark:text-gray-400">Convidados</span>
                      <GuestsInput value={guests} onChange={setGuests} />
                      <label className="mt-2 flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                        <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
                        Criar link do {provider === "google" ? "Google Meet" : "Teams"}
                      </label>
                      <button type="button" className="mt-2 text-theme-sm font-medium text-brand-600 hover:underline" onClick={() => void findSlots()}>
                        Ver horários livres no dia
                      </button>
                      {slots && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {slots.length === 0 && <span className="text-theme-xs text-gray-500">Nenhum horário livre (8h–19h).</span>}
                          {slots.map((s) => (
                            <button
                              key={s.toISOString()}
                              type="button"
                              onClick={() => setWhen(s)}
                              className={cn(
                                "rounded-md border px-2 py-1 text-theme-xs",
                                s.getTime() === when.getTime() ? "border-brand-500 bg-brand-500 text-white" : "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-gray-700 dark:text-gray-300",
                              )}
                            >
                              {String(s.getHours()).padStart(2, "0")}:{String(s.getMinutes()).padStart(2, "0")}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {calMsg && <p className="mt-2 text-theme-xs text-error-600">{calMsg}</p>}
                </div>
              )}
              {link && (
                <p className="mt-1 flex items-center gap-1 text-theme-xs text-gray-500">
                  <Link2 size={12} /> Contato e organização vêm do cartão vinculado.
                </p>
              )}
            </div>
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="mt-6 flex items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            <TaButton variant="primary" size="md" disabled={saving || !title.trim()} onClick={() => void save()}>
              Salvar
            </TaButton>
            <TaButton size="md" onClick={requestClose}>
              Cancelar
            </TaButton>
            {request.id && (
              <TaButton
                variant="ghost"
                className="ml-auto"
                startIcon={<Trash2 size={15} />}
                onClick={async () => {
                  if (series) return setAskScope("delete");
                  if (!confirm("Excluir esta atividade? Vai para a lixeira, de onde pode ser restaurado.")) return;
                  await call("activities.delete", { id: request.id! });
                  onSaved();
                }}
              >
                Excluir
              </TaButton>
            )}
          </div>
        </>
      )}
      </div>
    </TaModal>
    {minimized &&
      createPortal(
        <div
          className="fixed bottom-4 right-4 z-[99999] flex max-w-sm items-center gap-1 rounded-xl border border-warning-300 bg-warning-50 p-1 shadow-theme-lg dark:border-warning-500/40 dark:bg-gray-900"
          data-task-minimized
        >
          <button
            type="button"
            onClick={() => onMinimizedChange?.(false)}
            title="Reabrir a atividade"
            className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-theme-sm font-medium text-warning-800 hover:bg-warning-100 dark:text-warning-300 dark:hover:bg-white/5"
          >
            <Pencil size={14} className="shrink-0" />
            <span className="truncate">Atividade em edição: {title.trim() || "sem nome"}</span>
            <span className="shrink-0 text-theme-xs underline">Reabrir</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmClose(true)}
            title="Descartar"
            aria-label="Descartar a atividade em edição"
            className="rounded-lg p-2 text-gray-500 hover:bg-error-50 hover:text-error-600"
          >
            <X size={14} />
          </button>
        </div>,
        document.body,
      )}
    {confirmClose && (
      <UnsavedDialog
        items={[{ key: "this", scope: "this", label: draftLabel }]}
        confirmLabel="Descartar atividade"
        onStay={() => {
          setConfirmClose(false);
          onMinimizedChange?.(false);
        }}
        onDiscard={onClose}
      />
    )}
    </>
  );
}

/** Lembrete da própria agenda (popup): o menor com Chrome, senão o menor de todos. */
function popupLead(rules: ReminderRule[]): number | null {
  const pick = (list: ReminderRule[]) => (list.length ? Math.min(...list.map((r) => r.minutesBefore)) : null);
  return pick(rules.filter((r) => r.channels.includes("chrome"))) ?? pick(rules.filter((r) => r.channels.length));
}

const KIND_TEXT = { reminder: "Lembrete", overdue: "Atraso", digest: "Resumo", missed: "Resumo" } as const;

/** Histórico de envio dos avisos desta atividade. */
function DeliveryLog({ list }: { list: { channel: Channel; kind: keyof typeof KIND_TEXT; status: string; sent_at: string | null; last_error: string | null; updated_at: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2" data-delivery-log>
      <button type="button" className="text-theme-xs text-gray-500 hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? "Ocultar" : "Ver"} avisos enviados ({list.length})
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 text-theme-xs">
          {list.map((d, i) => (
            <li key={i} className={d.status === "sent" ? "text-gray-600 dark:text-gray-400" : "text-error-600"}>
              {KIND_TEXT[d.kind]} · {CHANNEL_LABEL[d.channel]} · {d.status === "sent" ? `enviado ${formatDateTime(d.sent_at ?? d.updated_at)}` : `falhou: ${d.last_error ?? "erro"}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tarefa nova: arquivos escolhidos agora viram documentos logo depois de salvar. */
function PendingFiles({ pending, onPending }: { pending: File[]; onPending: (f: File[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = (files: File[]) => {
    setError(null);
    const big = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (big) return setError(`"${big.name}" passa de 25 MB.`);
    onPending([...pending, ...files]);
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-theme-xs font-semibold uppercase tracking-wide text-gray-400">Documentos</span>
        <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-1 text-theme-xs font-medium text-brand-600 hover:underline">
          <Paperclip size={13} /> Anexar documentos
        </button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) add(files);
        }}
      />
      <ul className="space-y-1">
        {pending.map((f, i) => (
          <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-2.5 py-1.5 text-theme-xs dark:border-gray-700">
            <Paperclip size={13} className="text-gray-400" />
            <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{f.name}</span>
            <span className="text-gray-400">{formatBytes(f.size)} · nome e classificação ao salvar</span>
            <button type="button" title="Remover" className="text-gray-400 hover:text-error-600" onClick={() => onPending(pending.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          </li>
        ))}
        {pending.length === 0 && <li className="text-theme-xs text-gray-400">Nenhum documento.</li>}
      </ul>
      {error && <p className="mt-1 text-theme-xs text-error-600">{error}</p>}
    </div>
  );
}
