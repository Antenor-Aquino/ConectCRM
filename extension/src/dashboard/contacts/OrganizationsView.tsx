// Menu Organizações: lista com busca (nome, razão social, CNPJ), filtros
// (segmento, UF, responsável, tag), colunas, paginação, exportar e importar.
import { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { TaSelect } from "@tailadmin";
import { call } from "../../rpc/client";
import type { OrganizationListItem } from "../../db/contacts";
import type { Tag } from "../../db/tags";
import { formatCnpj } from "../../lib/cnpj";
import { downloadSpreadsheet } from "../../lib/spreadsheet";
import { useSession } from "../session";
import { DataList, PAGE_SIZE, type Column } from "../ui/DataList";
import { useImages } from "../ui/ImageUpload";
import { formatPhone } from "../ui/PhoneInput";
import { ImportModal, type ImportField } from "./ImportModal";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

const IMPORT_FIELDS: ImportField[] = [
  { key: "name", label: "Nome", required: true, aliases: ["nome", "nome fantasia", "fantasia", "organizacao", "organização", "empresa"] },
  { key: "cnpj", label: "CNPJ", aliases: ["cnpj"] },
  { key: "legalName", label: "Razão social", aliases: ["razao social", "razão social"] },
  { key: "segment", label: "Segmento", aliases: ["segmento", "ramo", "setor"] },
  { key: "website", label: "Site", aliases: ["site", "website", "url"] },
  { key: "email", label: "E-mail", aliases: ["email", "e-mail"] },
  { key: "phone", label: "Telefone", aliases: ["telefone", "fone", "phone"] },
  { key: "cep", label: "CEP", aliases: ["cep"] },
  { key: "street", label: "Logradouro", aliases: ["logradouro", "endereco", "endereço", "rua"] },
  { key: "number", label: "Número", aliases: ["numero", "número", "nº"] },
  { key: "district", label: "Bairro", aliases: ["bairro"] },
  { key: "city", label: "Cidade", aliases: ["cidade", "municipio", "município"] },
  { key: "state", label: "Estado", aliases: ["estado", "uf"] },
];

export function OrganizationsView({ refreshKey, onOpen, onNew }: { refreshKey: number; onOpen: (id: string) => void; onNew: () => void }) {
  const { users } = useSession();
  const [rows, setRows] = useState<OrganizationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("");
  const [state, setState] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [tagId, setTagId] = useState("");
  const [segments, setSegments] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [importing, setImporting] = useState(false);
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const logos = useImages(rows.map((r) => r.logo_id));

  const filter = { search, segment: segment || undefined, state: state || undefined, ownerId: ownerId || undefined, tagIds: tagId ? [tagId] : undefined };
  const load = useCallback(async () => {
    const [list, count] = await Promise.all([
      call("organizations.list", { ...filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      call("organizations.count", filter),
    ]);
    setRows(list);
    setTotal(count);
  }, [search, segment, state, ownerId, tagId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey, reload, search]);
  useEffect(() => setPage(0), [search, segment, state, ownerId, tagId]);
  useEffect(() => {
    void call("organizations.segments").then(setSegments);
    void call("tags.list", { entity: "organization" }).then(setTags);
    void call("customFields.list", { entity: "organization" }).then((f) => setCustomNames(f.map((x) => x.name)));
  }, [refreshKey, reload]);

  const columns: Column<OrganizationListItem>[] = [
    {
      key: "name",
      label: "Nome",
      render: (r) => (
        <span className="flex items-center gap-2 font-medium text-gray-800 dark:text-white/90">
          {r.logo_id && logos[r.logo_id] ? (
            <img src={logos[r.logo_id]} alt="" className="h-7 w-7 rounded-lg object-cover" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-warning-100 text-warning-700">
              <Building2 size={14} />
            </span>
          )}
          {r.name}
        </span>
      ),
    },
    { key: "cnpj", label: "CNPJ", render: (r) => (r.cnpj ? formatCnpj(r.cnpj) : "—"), className: "whitespace-nowrap" },
    { key: "segment", label: "Segmento", render: (r) => r.segment ?? "—" },
    { key: "city", label: "Cidade/UF", render: (r) => [r.city, r.state].filter(Boolean).join(" - ") || "—" },
    { key: "phone", label: "Telefone", render: (r) => formatPhone(r.phone) || "—", className: "whitespace-nowrap", hidden: true },
    { key: "email", label: "E-mail", render: (r) => r.email ?? "—", hidden: true },
    { key: "persons", label: "Contatos", render: (r) => r.persons_count },
    { key: "owner", label: "Responsável", render: (r) => r.owner_name ?? "—" },
  ];

  async function exportExcel() {
    const all = await call("organizations.list", { ...filter, limit: 100_000, offset: 0 });
    downloadSpreadsheet(
      `organizacoes-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "Organizações",
      ["Nome", "Razão social", "CNPJ", "Segmento", "Site", "E-mail", "Telefone", "CEP", "Logradouro", "Número", "Complemento", "Bairro", "Cidade", "UF", "Contatos", "Responsável"],
      all.map((r) => [
        r.name, r.legal_name, r.cnpj ? formatCnpj(r.cnpj) : null, r.segment, r.website, r.email, formatPhone(r.phone),
        r.cep, r.street, r.number, r.complement, r.district, r.city, r.state, r.persons_count, r.owner_name,
      ]),
    );
  }

  return (
    <>
      <DataList
        title="Organizações"
        storageKey="conectcrm-cols-organizations"
        columns={columns}
        rows={rows}
        total={total}
        page={page}
        onPage={setPage}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Pesquisar por nome, razão social ou CNPJ…"
        filters={
          <>
            <TaSelect className="w-44" value={segment} onChange={(e) => setSegment(e.target.value)}>
              <option value="">Segmento: todos</option>
              {segments.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </TaSelect>
            <TaSelect className="w-24" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">UF</option>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </TaSelect>
            <TaSelect className="w-44" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Responsável: todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </TaSelect>
            {tags.length > 0 && (
              <TaSelect className="w-36" value={tagId} onChange={(e) => setTagId(e.target.value)}>
                <option value="">Tag: todas</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </TaSelect>
            )}
          </>
        }
        onNew={onNew}
        newLabel="Organização"
        onExport={() => void exportExcel()}
        onImport={() => setImporting(true)}
        onRowClick={(r) => onOpen(r.id)}
        empty={search || segment || state || ownerId || tagId ? "Nenhuma organização encontrada com esses filtros." : "Nenhuma organização cadastrada ainda."}
      />
      {importing && (
        <ImportModal
          title="Importar organizações"
          fields={IMPORT_FIELDS}
          customFieldNames={customNames}
          onImport={(rows) => call("organizations.import", { rows: rows as never })}
          onClose={() => {
            setImporting(false);
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
