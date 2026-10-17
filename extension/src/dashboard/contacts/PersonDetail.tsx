// Ficha do contato: dados, organizações, negócios, tarefas, notas e histórico.
import { useCallback, useEffect, useState } from "react";
import { Lock, Merge, MessageCircle, Pencil, Star, Trash2 } from "lucide-react";
import { TaBadge, TaButton } from "@tailadmin";
import { call } from "../../rpc/client";
import type { PersonDetail as PersonData } from "../../db/contacts";
import type { CustomField } from "../../db/customFields";
import { useSession } from "../session";
import { searchPersons } from "../cards/searchers";
import { Avatar } from "../ui/Avatar";
import { ErrorText, SectionLabel } from "../ui/form";
import { useImages } from "../ui/ImageUpload";
import { NotesPanel } from "../ui/NotesPanel";
import { formatPhone } from "../ui/PhoneInput";
import { TagChip } from "../ui/TagPicker";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { ChangeLogList, CustomValuesView, DrawerShell, InfoRow, RelatedCards, RelatedTasks, Tabs } from "./detailParts";
import { MergeModal } from "./MergeModal";
import { PersonFormModal } from "./PersonFormModal";
import { errorText } from "../../lib/errors";

type Tab = "negocios" | "tarefas" | "documentos" | "notas" | "historico";

export function PersonDetail({
  personId,
  onClose,
  onChanged,
  onOpenOrganization,
  onOpenCard,
}: {
  personId: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenOrganization: (id: string) => void;
  onOpenCard: (pipelineId: string, cardId: string) => void;
}) {
  const { users } = useSession();
  const [p, setP] = useState<PersonData | null | undefined>(undefined);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [tab, setTab] = useState<Tab>("negocios");
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const images = useImages([p?.avatar_id]);

  // Os campos vêm junto: um campo novo pode ter sido criado no formulário de edição.
  const load = useCallback(
    () => Promise.all([call("persons.get", { id: personId }).then((r) => setP(r ?? null)), call("customFields.list", { entity: "person" }).then(setFields)]),
    [personId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const after = async () => {
    await load();
    onChanged();
  };

  if (p === undefined) return <DrawerShell onClose={onClose}>Carregando…</DrawerShell>;
  if (p === null) return <DrawerShell onClose={onClose}>Contato não encontrado ou sem permissão de acesso.</DrawerShell>;

  const waDigits = p.phone?.replace(/\D/g, "");
  return (
    <DrawerShell onClose={onClose}>
      <div className="mb-5 flex items-center gap-4 pr-10">
        {p.avatar_id && images[p.avatar_id] ? (
          <img src={images[p.avatar_id]} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <Avatar name={p.name} size={64} />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-theme-xl font-semibold text-gray-800 dark:text-white/90">
            {p.name} {!!p.is_private && <Lock size={15} className="text-gray-400" aria-label="Contato privado" />}
          </h1>
          {p.organizations[0] && <p className="text-theme-sm text-gray-500">{p.organizations[0].name}</p>}
        </div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <TaButton startIcon={<Pencil size={15} />} onClick={() => setEditing(true)}>
          Editar
        </TaButton>
        {waDigits && (
          <TaButton startIcon={<MessageCircle size={15} />} onClick={() => void chrome.tabs.create({ url: `https://web.whatsapp.com/send?phone=${waDigits}` })}>
            WhatsApp
          </TaButton>
        )}
        <TaButton startIcon={<Merge size={15} />} onClick={() => setMerging(true)}>
          Mesclar duplicado
        </TaButton>
        <TaButton
          variant="ghost"
          className="ml-auto"
          startIcon={<Trash2 size={15} />}
          onClick={async () => {
            if (!confirm(`Excluir o contato "${p.name}"?`)) return;
            try {
              await call("persons.delete", { id: p.id });
              onChanged();
              onClose();
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          Excluir
        </TaButton>
      </div>
      <ErrorText>{error}</ErrorText>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <SectionLabel className="mt-0">Dados</SectionLabel>
          <InfoRow label="E-mail">{p.email && <a className="text-brand-600 hover:underline" href={`mailto:${p.email}`}>{p.email}</a>}</InfoRow>
          <InfoRow label="Celular">{formatPhone(p.phone)}</InfoRow>
          <InfoRow label="Responsável">{users.find((u) => u.id === p.owner_id)?.name}</InfoRow>
          <InfoRow label="Organizações">
            {p.organizations.length > 0 && (
              <span className="flex flex-col gap-1">
                {p.organizations.map((o) => (
                  <button key={o.id} type="button" className="flex items-center gap-1 text-left text-brand-600 hover:underline" onClick={() => onOpenOrganization(o.id)}>
                    {o.name} {!!o.is_primary && <Star size={11} fill="currentColor" className="text-warning-500" />}
                  </button>
                ))}
              </span>
            )}
          </InfoRow>
          <InfoRow label="Tags">
            {p.tags.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {p.tags.map((t) => (
                  <TagChip key={t.id} tag={t} />
                ))}
              </span>
            )}
          </InfoRow>
          <CustomValuesView fields={fields} values={p.customValues} />
          {p.notes && (
            <>
              <SectionLabel>Notas do cadastro</SectionLabel>
              <p className="whitespace-pre-wrap rounded-lg bg-warning-25 p-3 text-theme-sm text-gray-700 dark:bg-white/5 dark:text-gray-300">{p.notes}</p>
            </>
          )}
          {!!p.is_private && (
            <p className="mt-3">
              <TaBadge color="slate" label="Contato privado" />
            </p>
          )}
        </div>
        <div>
          <Tabs<Tab>
            tabs={[
              ["negocios", "Negócios"],
              ["tarefas", "Tarefas"],
              ["documentos", "Documentos"],
              ["notas", "Notas"],
              ["historico", "Histórico"],
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "negocios" && <RelatedCards filter={{ personId: p.id }} onOpenCard={onOpenCard} />}
          {tab === "tarefas" && <RelatedTasks filter={{ personId: p.id }} />}
          {tab === "documentos" && <DocumentsPanel type="person" id={p.id} />}
          {tab === "notas" && <NotesPanel entityType="person" entityId={p.id} />}
          {tab === "historico" && <ChangeLogList table="person" id={p.id} />}
        </div>
      </div>

      {editing && (
        <PersonFormModal
          personId={p.id}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await after();
          }}
        />
      )}
      {merging && (
        <MergeModal
          keepId={p.id}
          keepName={p.name}
          noun="contato"
          search={searchPersons}
          onClose={() => setMerging(false)}
          onMerge={async (removeId) => {
            await call("persons.merge", { keepId: p.id, removeId });
            setMerging(false);
            await after();
          }}
        />
      )}
    </DrawerShell>
  );
}
