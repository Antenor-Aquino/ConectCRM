// Operações expostas pelo documento offscreen (dono do banco) às telas.
// Cada entrada recebe (db, ctx, params) e devolve dados serializáveis.
import * as activities from "../db/activities";
import * as contacts from "../db/contacts";
import * as cf from "../db/customFields";
import * as deals from "../db/deals";
import * as notes from "../db/notes";
import * as pipelines from "../db/pipelines";
import * as products from "../db/products";
import * as stages from "../db/stages";
import { rowHistory, type DataTable, type DbContext } from "../db/repo";
import { many, one, type DatabaseSync } from "../db/sql";
import { hashPin, verifyPin } from "../lib/pin";
import { ValidationError } from "../lib/validate";
import * as tags from "../db/tags";
import * as users from "../db/users";

type Handler = (db: DatabaseSync, ctx: DbContext, params: never) => unknown;
type Id = { id: string };
const viewer = (db: DatabaseSync, ctx: DbContext) => users.getViewer(db, ctx.userId);

/** Cadastro de usuários e equipes: só administrador (spec Fase 3). */
function assertAdmin(db: DatabaseSync, ctx: DbContext): void {
  if (viewer(db, ctx)?.role !== "admin") throw new ValidationError("Apenas administradores podem alterar usuários e equipes.");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const methods = {
  "system.info": (db: DatabaseSync, ctx: DbContext) => ({
    workspaceId: ctx.workspaceId,
    migrations: many<{ name: string }>(db, "SELECT name FROM _migrations ORDER BY name").map((r) => r.name),
    pendingSync: one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM change_log WHERE synced_at IS NULL")?.n ?? 0,
  }),
  "history.get": (db: DatabaseSync, ctx: DbContext, p: { table: DataTable; id: string }) => {
    if (p.table === "deal") deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return rowHistory(db, p.table, p.id);
  },

  // Usuários e equipes
  "users.list": (db: DatabaseSync, _c: DbContext, p: { includeInactive?: boolean } = {}) => users.listUsers(db, p),
  "users.create": (db: DatabaseSync, ctx: DbContext, p: users.UserInput) => {
    // O primeiro usuário (administrador) é criado sem ninguém logado.
    if (users.listUsers(db, { includeInactive: true }).length > 0) assertAdmin(db, ctx);
    return users.createUser(db, ctx, p);
  },
  "users.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Parameters<typeof users.updateUser>[3] }) => {
    const v = viewer(db, ctx);
    const selfBasic = v?.id === p.id && p.patch.role === undefined && p.patch.active === undefined;
    if (!selfBasic) assertAdmin(db, ctx);
    users.updateUser(db, ctx, p.id, p.patch);
  },
  /** Define (ou remove, com pin null) o PIN: o próprio usuário ou um administrador. */
  "users.setPin": async (db: DatabaseSync, ctx: DbContext, p: Id & { pin: string | null }) => {
    if (viewer(db, ctx)?.id !== p.id) assertAdmin(db, ctx);
    const hash = p.pin === null ? null : await hashPin(p.pin);
    users.setUserPinHash(db, ctx, p.id, hash);
  },
  "users.verifyPin": async (db: DatabaseSync, _c: DbContext, p: Id & { pin: string }) => {
    const ok = await verifyPin(p.pin, users.getUserPinHash(db, p.id));
    if (!ok) await sleep(600); // freia tentativas em sequência
    return ok;
  },
  "teams.list": (db: DatabaseSync) => users.listTeams(db),
  "teams.create": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof users.createTeam>[2]) => {
    assertAdmin(db, ctx);
    return users.createTeam(db, ctx, p);
  },
  "teams.rename": (db: DatabaseSync, ctx: DbContext, p: Id & { name: string }) => {
    assertAdmin(db, ctx);
    users.renameTeam(db, ctx, p.id, p.name);
  },
  "teams.setMembers": (db: DatabaseSync, ctx: DbContext, p: Id & { members: { userId: string; isLeader?: boolean }[] }) => {
    assertAdmin(db, ctx);
    users.setTeamMembers(db, ctx, p.id, p.members);
  },
  "teams.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertAdmin(db, ctx);
    users.deleteTeam(db, ctx, p.id);
  },

  // Funis
  "pipelines.list": (db: DatabaseSync, _c: DbContext, p: { includeArchived?: boolean } = {}) => pipelines.listPipelines(db, p),
  "pipelines.activeTypes": (db: DatabaseSync) => pipelines.activePipelineTypes(db),
  "pipelines.create": (db: DatabaseSync, ctx: DbContext, p: pipelines.NewPipeline) => pipelines.createPipeline(db, ctx, p),
  "pipelines.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Parameters<typeof pipelines.updatePipeline>[3] }) =>
    pipelines.updatePipeline(db, ctx, p.id, p.patch),
  "pipelines.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => pipelines.deletePipeline(db, ctx, p.id),
  "stages.list": (db: DatabaseSync, _c: DbContext, p: { pipelineId: string }) => pipelines.listStages(db, p.pipelineId),
  "stages.save": (db: DatabaseSync, ctx: DbContext, p: { pipelineId: string; stages: stages.StageDraft[]; moveTo?: Record<string, string> }) =>
    stages.saveStages(db, ctx, p.pipelineId, p.stages, p.moveTo),

  // Cartões (negócio / ticket / etapa de projeto)
  "board.get": (db: DatabaseSync, ctx: DbContext, p: { pipelineId: string } & Omit<NonNullable<Parameters<typeof deals.getBoard>[2]>, "viewer">) =>
    deals.getBoard(db, p.pipelineId, { ...p, viewer: viewer(db, ctx) }),
  "cards.get": (db: DatabaseSync, ctx: DbContext, p: Id) => deals.getCard(db, p.id, viewer(db, ctx)) ?? null,
  "cards.create": (db: DatabaseSync, ctx: DbContext, p: deals.CardInput) => {
    const v = viewer(db, ctx);
    deals.assertCanAssign(db, v, p.ownerId === undefined ? ctx.userId : p.ownerId);
    return deals.createCard(db, ctx, p);
  },
  "cards.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Parameters<typeof deals.updateCard>[3] }) => {
    const v = viewer(db, ctx);
    deals.assertCardAccess(db, v, p.id);
    if (p.patch.ownerId !== undefined) deals.assertCanAssign(db, v, p.patch.ownerId);
    deals.updateCard(db, ctx, p.id, p.patch);
  },
  "cards.move": (db: DatabaseSync, ctx: DbContext, p: Id & { stageId: string; beforeId?: string | null }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    deals.moveCard(db, ctx, p.id, p);
  },
  "cards.setStatus": (db: DatabaseSync, ctx: DbContext, p: Id & Parameters<typeof deals.setCardStatus>[3]) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    deals.setCardStatus(db, ctx, p.id, p);
  },
  "cards.setItems": (db: DatabaseSync, ctx: DbContext, p: Id & { items: deals.DealItemInput[] }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    deals.setDealItems(db, ctx, p.id, p.items);
  },
  "cards.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    deals.deleteCard(db, ctx, p.id);
  },
  "lossReasons.list": (db: DatabaseSync, _c: DbContext, p: { includeInactive?: boolean } = {}) => deals.listLossReasons(db, p),
  "lossReasons.create": (db: DatabaseSync, ctx: DbContext, p: { name: string }) => deals.createLossReason(db, ctx, p.name),
  "lossReasons.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: { name?: string; active?: boolean } }) =>
    deals.updateLossReason(db, ctx, p.id, p.patch),

  // Contatos e organizações
  "persons.list": (db: DatabaseSync, ctx: DbContext, p: Omit<NonNullable<Parameters<typeof contacts.listPersons>[1]>, "viewer"> = {}) =>
    contacts.listPersons(db, { ...p, viewer: viewer(db, ctx) }),
  "persons.get": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.getPerson(db, p.id, viewer(db, ctx)),
  "persons.create": (db: DatabaseSync, ctx: DbContext, p: contacts.PersonInput) => contacts.createPerson(db, ctx, p),
  "persons.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<contacts.PersonInput> }) => contacts.updatePerson(db, ctx, p.id, p.patch),
  "persons.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.deletePerson(db, ctx, p.id),
  "persons.findDuplicates": (db: DatabaseSync, _c: DbContext, p: Parameters<typeof contacts.findDuplicatePersons>[1]) =>
    contacts.findDuplicatePersons(db, p),
  "persons.setPrimaryOrganization": (db: DatabaseSync, ctx: DbContext, p: { personId: string; organizationId: string }) =>
    contacts.setPrimaryOrganization(db, ctx, p.personId, p.organizationId),
  "organizations.list": (db: DatabaseSync, _c: DbContext, p: Parameters<typeof contacts.listOrganizations>[1] = {}) => contacts.listOrganizations(db, p),
  "organizations.get": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.getOrganization(db, p.id, viewer(db, ctx)),
  "organizations.create": (db: DatabaseSync, ctx: DbContext, p: contacts.OrganizationInput) => contacts.createOrganization(db, ctx, p),
  "organizations.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<contacts.OrganizationInput> }) =>
    contacts.updateOrganization(db, ctx, p.id, p.patch),
  "organizations.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.deleteOrganization(db, ctx, p.id),
  "organizations.findByCnpj": (db: DatabaseSync, _c: DbContext, p: { cnpj: string }) => contacts.findOrganizationByCnpj(db, p.cnpj) ?? null,
  "organizations.segments": (db: DatabaseSync) => contacts.listSegments(db),

  // Tarefas
  "activityTypes.list": (db: DatabaseSync, _c: DbContext, p: { includeInactive?: boolean } = {}) => activities.listActivityTypes(db, p),
  "activityTypes.create": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof activities.createActivityType>[2]) =>
    activities.createActivityType(db, ctx, p),
  "activityTypes.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Parameters<typeof activities.updateActivityType>[3] }) =>
    activities.updateActivityType(db, ctx, p.id, p.patch),
  "activities.list": (db: DatabaseSync, _c: DbContext, p: activities.ActivityFilter = {}) => activities.listActivities(db, p),
  "activities.get": (db: DatabaseSync, _c: DbContext, p: Id) => activities.getActivity(db, p.id),
  "activities.create": (db: DatabaseSync, ctx: DbContext, p: activities.ActivityInput) => activities.createActivity(db, ctx, p),
  "activities.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<activities.ActivityInput> }) =>
    activities.updateActivity(db, ctx, p.id, p.patch),
  "activities.setDone": (db: DatabaseSync, ctx: DbContext, p: Id & { done: boolean }) => activities.setActivityDone(db, ctx, p.id, p.done),
  "activities.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => activities.deleteActivity(db, ctx, p.id),

  // Notas
  "notes.list": (db: DatabaseSync, _c: DbContext, p: { entityType: notes.NoteEntity; entityId: string }) => notes.listNotes(db, p.entityType, p.entityId),
  "notes.add": (db: DatabaseSync, ctx: DbContext, p: { entityType: notes.NoteEntity; entityId: string; body: string }) =>
    notes.addNote(db, ctx, p.entityType, p.entityId, p.body),
  "notes.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: { body?: string; pinned?: boolean } }) => notes.updateNote(db, ctx, p.id, p.patch),
  "notes.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => notes.deleteNote(db, ctx, p.id),

  // Tags
  "tags.list": (db: DatabaseSync, _c: DbContext, p: { entity: tags.TagEntity; includeInactive?: boolean }) => tags.listTags(db, p.entity, p),
  "tags.create": (db: DatabaseSync, ctx: DbContext, p: { entity: tags.TagEntity; name: string; color?: string }) => tags.createTag(db, ctx, p),
  "tags.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: { name?: string; color?: string; active?: boolean } }) =>
    tags.updateTag(db, ctx, p.id, p.patch),
  "tags.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => tags.deleteTag(db, ctx, p.id),

  // Campos personalizados
  "customFields.list": (db: DatabaseSync, _c: DbContext, p: { entity: cf.CustomFieldEntity; pipelineId?: string; includeInactive?: boolean }) =>
    cf.listCustomFields(db, p.entity, p),
  "customFields.create": (db: DatabaseSync, ctx: DbContext, p: cf.CustomFieldInput) => cf.createCustomField(db, ctx, p),
  "customFields.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Parameters<typeof cf.updateCustomField>[3] }) =>
    cf.updateCustomField(db, ctx, p.id, p.patch),
  "customFields.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => cf.deleteCustomField(db, ctx, p.id),

  // Produtos e serviços
  "products.list": (db: DatabaseSync, _c: DbContext, p: Parameters<typeof products.listProducts>[1] = {}) => products.listProducts(db, p),
  "products.create": (db: DatabaseSync, ctx: DbContext, p: products.ProductInput) => products.createProduct(db, ctx, p),
  "products.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<products.ProductInput> }) => products.updateProduct(db, ctx, p.id, p.patch),
  "products.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => products.deleteProduct(db, ctx, p.id),
  "productCategories.list": (db: DatabaseSync) => products.listProductCategories(db),
  "productCategories.create": (db: DatabaseSync, ctx: DbContext, p: { name: string }) => products.createProductCategory(db, ctx, p.name),
  "productCategories.rename": (db: DatabaseSync, ctx: DbContext, p: Id & { name: string }) => products.renameProductCategory(db, ctx, p.id, p.name),
  "productCategories.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => products.deleteProductCategory(db, ctx, p.id),
} satisfies Record<string, Handler>;

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type MethodParams<M extends MethodName> = Parameters<Methods[M]>[2];
export type MethodResult<M extends MethodName> = Awaited<ReturnType<Methods[M]>>;
