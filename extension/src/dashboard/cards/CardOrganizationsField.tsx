// "Outras organizações" do cartão: quem paga (ex.: o Caixa Escolar), a
// mantenedora, outras escolas/unidades da rede ou outra relação. A pagadora é
// quem aparece na cobrança, na NFS-e (tomador) e na Gestão Financeira.
import { useState } from "react";
import { Building2, PlusCircle, Star, X } from "lucide-react";
import { cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { CARD_ORG_ROLE_LABEL, CARD_ORG_ROLES, type CardOrganization, type CardOrgRole } from "../../db/cardOrganizations";
import { Combobox } from "../ui/Combobox";
import { Field } from "../ui/form";
import { createOrganizationQuick, searchOrganizations } from "./searchers";

const ROLE_HINT: Record<CardOrgRole, string> = {
  pagador: "Paga: vai na cobrança, na nota fiscal e na Gestão Financeira",
  mantenedora: "Empresa mantenedora da escola/rede",
  cliente: "Outra escola/unidade atendida neste cartão",
  outra: "Outra relação",
};

export function CardOrganizationsField({
  cardId,
  organizations,
  run,
  onOpen,
}: {
  cardId: string;
  organizations: CardOrganization[];
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  onOpen: (organizationId: string) => void;
}) {
  const others = organizations.filter((o) => o.role !== "principal");
  const hasPayer = others.some((o) => o.role === "pagador");
  const principal = organizations.find((o) => o.role === "principal");
  /** null = pelo tipo do cadastro da organização. */
  const [newRole, setNewRole] = useState<CardOrgRole | null>(null);
  return (
    <Field
      label={`Outras organizações${others.length ? ` (${others.length})` : ""}`}
      hint={
        others.length
          ? principal && !hasPayer
            ? `Sem pagador: a cobrança e a nota fiscal saem em nome de ${principal.name}.`
            : undefined
          : "Quem paga (ex.: o Caixa Escolar), a mantenedora ou outras escolas da rede. O papel vem do tipo no cadastro da organização (dá para trocar aqui). O pagador vai na cobrança, na nota fiscal e na Gestão Financeira."
      }
    >
      <div data-card-orgs>
        {others.map((o) => (
          <div key={o.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700" data-card-org={o.name}>
            <Building2 size={15} className={cn("shrink-0", o.role === "pagador" ? "text-success-600" : "text-gray-400")} />
            <button type="button" title="Editar o cadastro da organização" onClick={() => onOpen(o.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-theme-sm font-medium text-brand-600 hover:underline">{o.name}</span>
              <span className="block truncate text-theme-xs text-gray-500">
                {[ROLE_HINT[o.role as CardOrgRole], [o.city, o.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")}
              </span>
            </button>
            <select
              aria-label={`Papel de ${o.name}`}
              className="h-8 shrink-0 rounded-lg border border-gray-300 bg-white px-1.5 text-theme-xs dark:border-gray-700 dark:bg-gray-900"
              value={o.role}
              onChange={(e) => void run(() => call("cards.organizations.setRole", { id: cardId, organizationId: o.id, role: e.target.value as CardOrgRole }))}
              data-card-org-role
            >
              {CARD_ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {CARD_ORG_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="Tornar a organização principal"
              onClick={() => void run(() => call("cards.organizations.setPrimary", { id: cardId, organizationId: o.id }))}
              className="text-gray-400 hover:text-warning-500"
            >
              <Star size={15} />
            </button>
            <button
              type="button"
              title="Desvincular do cartão"
              onClick={() => void run(() => call("cards.organizations.remove", { id: cardId, organizationId: o.id }))}
              className="text-gray-400 hover:text-error-600"
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <select
            aria-label="Vincular como"
            title="Papel da organização que vai ser vinculada"
            className="h-10 shrink-0 rounded-lg border border-gray-300 bg-white px-2 text-theme-xs dark:border-gray-700 dark:bg-gray-900"
            value={newRole ?? ""}
            onChange={(e) => setNewRole((e.target.value || null) as CardOrgRole | null)}
            data-card-org-new-role
          >
            <option value="">Pelo tipo do cadastro</option>
            {CARD_ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {CARD_ORG_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <div className="min-w-0 flex-1">
            <Combobox
              value={null}
              onChange={(i) =>
                i &&
                void run(() => call("cards.organizations.add", { id: cardId, organizationId: i.id, role: newRole })).then((ok) => ok && setNewRole(null))
              }
              search={searchOrganizations}
              placeholder="Buscar organização"
              onCreate={createOrganizationQuick}
              createLabel="Criar organização"
              dashed={
                <>
                  <PlusCircle size={15} /> Adicionar organização{newRole ? ` (${CARD_ORG_ROLE_LABEL[newRole].toLowerCase()})` : ""}
                </>
              }
            />
          </div>
        </div>
      </div>
    </Field>
  );
}
