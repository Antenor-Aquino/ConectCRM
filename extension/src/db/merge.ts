// Mesclar cadastros duplicados (spec 03 e 04) — atalho com a escolha padrão:
// o mantido fica com tudo o que estava ligado ao removido (ver mergeRecords.ts),
// os campos vazios dele são completados e as observações/descrições juntadas.
// A tela de mesclagem (com escolha campo a campo) chama mergeRecords direto.
import type { DbContext } from "./repo";
import type { DatabaseSync } from "./sql";
import { defaultChoices, mergeRecords } from "./mergeRecords";

export function mergePersons(db: DatabaseSync, ctx: DbContext, keepId: string, removeId: string): void {
  mergeRecords(db, ctx, { entity: "person", keepId, removeId, ...defaultChoices(db, "person", keepId, removeId) });
}

export function mergeOrganizations(db: DatabaseSync, ctx: DbContext, keepId: string, removeId: string): void {
  mergeRecords(db, ctx, { entity: "organization", keepId, removeId, ...defaultChoices(db, "organization", keepId, removeId) });
}
