// Ficha da organização: dados da Receita, contatos, negócios, tarefas, notas e histórico.
import { useCallback, useEffect, useState } from "react";
import { Building2, ExternalLink, Merge, Pencil, Star, Trash2 } from "lucide-react";
import { TaButton } from "@tailadmin";
import { call } from "../../rpc/client";
import type { OrganizationDetail as OrgData } from "../../db/contacts";
import type { CustomField } from "../../db/customFields";
import { formatCnpj } from "../../lib/cnpj";
import { formatCepInput } from "../../lib/cep";
import { useSession } from "../session";
import { searchOrganizations } from "../cards/searchers";
import { ErrorText, SectionLabel } from "../ui/form";
import { useImages } from "../ui/ImageUpload";
import { NotesPanel } from "../ui/NotesPanel";
import { formatPhone } from "../ui/PhoneInput";
import { TagChip } from "../ui/TagPicker";
import { ChangeLogList, CustomValuesView, DrawerShell, InfoRow, RelatedCards, RelatedTasks, Tabs } from "./detailParts";
import { MergeModal } from "./MergeModal";
import { OrganizationFormModal } from "./OrganizationFormModal";

type Tab = "contatos" | "negocios" | "tarefas" | "notas" | "historico";

export function OrganizationDetail({
  organizationId,
  onClose,
  onChanged,
  onOpenPerson,
  onOpenCard,
}: {
  organizationId: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenPerson: (id: string) => void;
  onOpenCard: (pipelineId: string, cardId: string) => void;
}) {
  const { users } = useSession();
  const [o, setO] = useState<OrgData | null | undefined>(undefined);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [tab, setTab] = useState<Tab>("contatos");
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const images = useImages([o?.logo_id]);

  const load = useCallback(() => call("organizations.get", { id: organizationId }).then((r) => setO(r ?? null)), [organizationId]);
  useEffect(() => {
    void load();
    void call("customFields.list", { entity: "organization" }).then(setFields);
  }, [load]);
  const after = async () => {
    await load();
    onChanged();
  };

  if (o === undefined) return <DrawerShell onClose={onClose}>Carregando…</DrawerShell>;
  if (o === null) return <DrawerShell onClose={onClose}>Organização não encontrada.</DrawerShell>;

  const address = [
    [o.street, o.number].filter(Boolean).join(", "),
    o.complement,
    o.district,
    [o.city, o.state].filter(Boolean).join(" - "),
    o.cep && `CEP ${formatCepInput(o.cep)}`,
    o.country !== "Brasil" ? o.country : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const site = o.website ? (o.website.startsWith("http") ? o.website : `https://${o.website}`) : null;

  return (
    <DrawerShell onClose={onClose}>
      <div className="mb-5 flex items-center gap-4 pr-10">
        {o.logo_id && images[o.logo_id] ? (
          <img src={images[o.logo_id]} alt="" className="h-16 w-16 rounded-2xl object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warning-100 text-warning-700">
            <Building2 size={28} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-theme-xl font-semibold text-gray-800 dark:text-white/90">{o.name}</h1>
          {o.legal_name && <p className="text-theme-sm text-gray-500">{o.legal_name}</p>}
        </div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <TaButton startIcon={<Pencil size={15} />} onClick={() => setEditing(true)}>
          Editar
        </TaButton>
        <TaButton startIcon={<Merge size={15} />} onClick={() => setMerging(true)}>
          Mesclar duplicada
        </TaButton>
        <TaButton
          variant="ghost"
          className="ml-auto"
          startIcon={<Trash2 size={15} />}
          onClick={async () => {
            if (!confirm(`Excluir a organização "${o.name}"?`)) return;
            try {
              await call("organizations.delete", { id: o.id });
              onChanged();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Excluir
        </TaButton>
      </div>
      <ErrorText>{error}</ErrorText>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <SectionLabel className="mt-0">Empresa</SectionLabel>
          <InfoRow label="CNPJ">{o.cnpj && formatCnpj(o.cnpj)}</InfoRow>
          <InfoRow label="Segmento">{o.segment}</InfoRow>
          <InfoRow label="Site">
            {site && (
              <a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={site} target="_blank" rel="noopener">
                {o.website} <ExternalLink size={12} />
              </a>
            )}
          </InfoRow>
          <InfoRow label="Responsável">{users.find((u) => u.id === o.owner_id)?.name}</InfoRow>
          <InfoRow label="Telefone">{formatPhone(o.phone)}</InfoRow>
          <InfoRow label="E-mail">{o.email && <a className="text-brand-600 hover:underline" href={`mailto:${o.email}`}>{o.email}</a>}</InfoRow>
          <InfoRow label="Endereço">{address}</InfoRow>
          <InfoRow label="Tags">
            {o.tags.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {o.tags.map((t) => (
                  <TagChip key={t.id} tag={t} />
                ))}
              </span>
            )}
          </InfoRow>
          <CustomValuesView fields={fields} values={o.customValues} />
          {o.description && (
            <>
              <SectionLabel>Descrição</SectionLabel>
              <p className="whitespace-pre-wrap text-theme-sm text-gray-700 dark:text-gray-300">{o.description}</p>
            </>
          )}
        </div>
        <div>
          <Tabs<Tab>
            tabs={[
              ["contatos", `Contatos (${o.persons.length})`],
              ["negocios", "Negócios"],
              ["tarefas", "Tarefas"],
              ["notas", "Notas"],
              ["historico", "Histórico"],
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "contatos" &&
            (o.persons.length === 0 ? (
              <p className="text-theme-sm text-gray-400">Nenhum contato vinculado.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {o.persons.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="flex w-full items-center gap-2 py-2.5 text-left text-theme-sm text-brand-600 hover:underline" onClick={() => onOpenPerson(p.id)}>
                      {p.name}
                      {!!p.is_primary && <Star size={11} fill="currentColor" className="text-warning-500" />}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          {tab === "negocios" && <RelatedCards filter={{ organizationId: o.id }} onOpenCard={onOpenCard} />}
          {tab === "tarefas" && <RelatedTasks filter={{ organizationId: o.id }} />}
          {tab === "notas" && <NotesPanel entityType="organization" entityId={o.id} />}
          {tab === "historico" && <ChangeLogList table="organization" id={o.id} />}
        </div>
      </div>

      {editing && (
        <OrganizationFormModal
          organizationId={o.id}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await after();
          }}
        />
      )}
      {merging && (
        <MergeModal
          keepId={o.id}
          keepName={o.name}
          noun="organização"
          search={searchOrganizations}
          onClose={() => setMerging(false)}
          onMerge={async (removeId) => {
            await call("organizations.merge", { keepId: o.id, removeId });
            setMerging(false);
            await after();
          }}
        />
      )}
    </DrawerShell>
  );
}
