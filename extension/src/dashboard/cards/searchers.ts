// Buscas usadas nos campos Contato / Organização dos formulários.
import { call } from "../../rpc/client";
import type { ComboItem } from "../ui/Combobox";

export async function searchPersons(text: string): Promise<ComboItem[]> {
  const list = await call("persons.list", { search: text, limit: 10 });
  return list.map((p) => ({ id: p.id, label: p.name, sublabel: p.phone ?? p.email ?? p.primary_organization_name }));
}

export async function createPersonQuick(name: string): Promise<ComboItem> {
  const id = await call("persons.create", { name });
  return { id, label: name };
}

export async function searchOrganizations(text: string): Promise<ComboItem[]> {
  const list = await call("organizations.list", { search: text, limit: 10 });
  return list.map((o) => ({ id: o.id, label: o.name, sublabel: o.city }));
}

export async function createOrganizationQuick(name: string): Promise<ComboItem> {
  const id = await call("organizations.create", { name });
  return { id, label: name };
}
