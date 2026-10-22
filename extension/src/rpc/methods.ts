// Operações expostas pelo documento offscreen (dono do banco) às telas.
// Cada entrada recebe (db, ctx, params) e devolve dados serializáveis.
import * as activities from "../db/activities";
import { cardCounts } from "../db/cardCounts";
import { globalSearch } from "../db/globalSearch";
import { cardHistory } from "../db/cardHistory";
import { cardFieldValues } from "../db/cardFieldValues";
import * as attachments from "../db/attachments";
import * as importer from "../db/importer";
import * as cardImporter from "../db/cardImporter";
import * as bulk from "../db/bulkCards";
import * as cardContacts from "../db/cardContacts";
import * as notify from "../db/notifications";
import type { NotifySettings } from "../lib/notify/settings";
import * as ext from "../db/externalImport";
import * as merge from "../db/merge";
import * as contacts from "../db/contacts";
import * as copilot from "../db/copilot";
import * as cf from "../db/customFields";
import * as deals from "../db/deals";
import * as docs from "../db/documents";
import * as folders from "../db/documentFolders";
import * as series from "../db/activitySeries";
import * as contactMsg from "../db/contactMessages";
import type { RecurrenceRule } from "../lib/recurrence";
import * as notes from "../db/notes";
import * as pipelines from "../db/pipelines";
import * as products from "../db/products";
import * as reports from "../db/reports";
import * as similar from "../db/similar";
import * as stages from "../db/stages";
import * as trash from "../db/trash";
import * as waLog from "../db/whatsappLog";
import { rowHistory, type DataTable, type DbContext } from "../db/repo";
import { many, one, withTransaction, type DatabaseSync } from "../db/sql";
import { hashPin, verifyPin } from "../lib/pin";
import { ValidationError } from "../lib/validate";
import { normalizeText } from "../lib/search";
import * as tags from "../db/tags";
import * as docCard from "../db/docCard";
import * as finance from "../db/finance";
import { contactCardFor } from "../db/contactCard";
import type { FinanceItem, ReturnPackage } from "../lib/finance/protocol";
import * as users from "../db/users";

type Handler = (db: DatabaseSync, ctx: DbContext, params: never) => unknown;
type Id = { id: string };
const viewer = (db: DatabaseSync, ctx: DbContext) => users.getViewer(db, ctx.userId);

/** Cadastro de usuários e equipes: só administrador (spec Fase 3). */
function assertAdmin(db: DatabaseSync, ctx: DbContext): void {
  if (viewer(db, ctx)?.role !== "admin") throw new ValidationError("Apenas administradores podem alterar usuários e equipes.");
}

/** Configurações gerais: campos e tags só administrador; produtos e motivos também gestor. */
function assertRole(db: DatabaseSync, ctx: DbContext, roles: users.Role[], what: string): void {
  const v = viewer(db, ctx);
  if (v && !roles.includes(v.role)) throw new ValidationError(`Sem permissão para alterar ${what}.`);
}
const ADMIN: users.Role[] = ["admin"];
/** Integrações (importar do Pipedrive...): só administrador. */
function assertIntegrations(db: DatabaseSync, ctx: DbContext): void {
  if (viewer(db, ctx)?.role !== "admin") throw new ValidationError("Apenas administradores podem usar as integrações.");
}
const MANAGERS: users.Role[] = ["admin", "gestor"];

/** Tarefa fora do escopo do usuário (vendedor: só as suas; gestor: equipe). */
/** Última vez que as séries recorrentes foram completadas (nesta sessão do banco). */
let lastSeriesTopUp = 0;

function assertActivityAccess(db: DatabaseSync, ctx: DbContext, id: string): void {
  const scope = activities.activityScope(db, viewer(db, ctx));
  const ok = one(db, `SELECT 1 FROM activity a WHERE a.id = ? AND a.deleted_at IS NULL${scope.sql ? ` AND ${scope.sql}` : ""}`, id, ...scope.params);
  if (!ok) throw new ValidationError("Atividade não encontrada ou sem permissão de acesso.");
}

/** Cadastro onde se anexa ou a que se vincula um documento: segue a permissão dele. */
function assertEntityAccess(db: DatabaseSync, ctx: DbContext, type: docs.DocLinkType, id: string): void {
  if (type === "deal") deals.assertCardAccess(db, viewer(db, ctx), id);
  else if (type === "activity") assertActivityAccess(db, ctx, id);
  else if (type !== "person" && type !== "organization") throw new ValidationError("Tipo de vínculo inválido.");
}

function assertLinksAccess(db: DatabaseSync, ctx: DbContext, links: docs.DocLinkRef[] | undefined): void {
  for (const l of links ?? []) assertEntityAccess(db, ctx, l.type, l.id);
}

const docView = (db: DatabaseSync, ctx: DbContext, id: string, opts?: { includeTrash?: boolean }) => docs.assertDocumentAccess(db, viewer(db, ctx), id, opts);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const methods = {
  "system.info": (db: DatabaseSync, ctx: DbContext) => ({
    workspaceId: ctx.workspaceId,
    migrations: many<{ name: string }>(db, "SELECT name FROM _migrations ORDER BY name").map((r) => r.name),
    pendingSync: one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM change_log WHERE synced_at IS NULL")?.n ?? 0,
  }),
  "cards.history": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return cardHistory(db, p.id);
  },
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
    return users.deleteTeam(db, ctx, p.id);
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
  "board.hiddenByFilter": (db: DatabaseSync, ctx: DbContext, p: { pipelineId: string } & Omit<NonNullable<Parameters<typeof deals.boardHiddenByFilter>[2]>, "viewer">) =>
    deals.boardHiddenByFilter(db, p.pipelineId, { ...p, viewer: viewer(db, ctx) }),
  /** Prévia dos campos do cartão (Editar funil → Cartão) no cartão mais recente do funil. */
  "cards.previewFields": (db: DatabaseSync, ctx: DbContext, p: { pipelineId: string; keys: string[] }) => {
    const scope = deals.cardScope(db, viewer(db, ctx));
    const card = one<{ id: string; title: string }>(
      db,
      `SELECT d.id, d.title FROM deal d WHERE d.pipeline_id = ? AND d.deleted_at IS NULL${scope.sql} ORDER BY d.status = 'open' DESC, d.updated_at DESC LIMIT 1`,
      p.pipelineId,
      ...scope.params,
    );
    if (!card) return null;
    const { values } = cardFieldValues(db, p.pipelineId, [card.id], { keys: p.keys });
    return { title: card.title, fields: values.get(card.id) ?? {} };
  },
  "cards.get": (db: DatabaseSync, ctx: DbContext, p: Id) => deals.getCard(db, p.id, viewer(db, ctx)) ?? null,
  "cards.create": (db: DatabaseSync, ctx: DbContext, p: deals.CardInput) => {
    const v = viewer(db, ctx);
    deals.assertCanAssign(db, v, p.ownerId === undefined ? ctx.userId : p.ownerId);
    return deals.createCard(db, ctx, p);
  },
  /** Copiloto: cartão a partir de um documento, depois da confirmação do usuário (spec 12). */
  "copilot.createFromDocument": (db: DatabaseSync, ctx: DbContext, p: docCard.DocCardInput) => {
    const v = viewer(db, ctx);
    deals.assertCanAssign(db, v, ctx.userId);
    return docCard.createCardFromDocument(db, ctx, v, p);
  },
  /** Origem de um registro criado por automação (cartão, contato, organização). */
  "origins.of": (db: DatabaseSync, _c: DbContext, p: Id) => docCard.recordOrigin(db, p.id),
  // Financeiro do cartão (spec 13): quem é o cliente/fornecedor e a cópia dos lançamentos da Gestão Financeira.
  "finance.cardCounterparty": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return finance.cardCounterparty(db, p.id);
  },
  /** Cartão ganho/concluído: não registrar (ou voltar a registrar) o valor no financeiro. */
  "finance.setSkip": (db: DatabaseSync, ctx: DbContext, p: { dealId: string; skip: boolean }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.dealId);
    finance.setFinanceSkip(db, ctx, p.dealId, p.skip);
  },
  "finance.card": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return finance.cardFinance(db, p.id);
  },
  "finance.replace": (db: DatabaseSync, ctx: DbContext, p: { dealIds: string[]; items: FinanceItem[]; env: string; at: string }) => {
    const v = viewer(db, ctx);
    for (const id of p.dealIds) deals.assertCardAccess(db, v, id);
    finance.replaceFinance(db, ctx, p.dealIds, p.items, p.env, p.at);
  },
  // Leitura geral (relatórios, financeiro do cliente): a cópia vale para todos; cada tela filtra pela permissão.
  "finance.replaceAll": (db: DatabaseSync, ctx: DbContext, p: { items: FinanceItem[]; env: string; at: string }) => finance.replaceAllFinance(db, ctx, p.items, p.env, p.at),
  "finance.syncedAt": (db: DatabaseSync) => finance.financeSyncedAt(db),
  // Todos os cartões (só ids): a leitura em lotes precisa de todos, senão a cópia geral perderia os dos colegas.
  "finance.cardIds": (db: DatabaseSync) => many<{ id: string }>(db, "SELECT id FROM deal WHERE deleted_at IS NULL").map((r) => r.id),
  "finance.report": (
    db: DatabaseSync,
    ctx: DbContext,
    p: Omit<finance.FinanceReportFilter, "viewer" | "ownerIds"> & { ownerId?: string | null; teamId?: string | null },
  ) => {
    let ownerIds: string[] | null = null;
    if (p.ownerId) ownerIds = [p.ownerId];
    else if (p.teamId) {
      ownerIds = many<{ user_id: string }>(db, "SELECT user_id FROM team_member WHERE team_id = ? AND deleted_at IS NULL", p.teamId).map((r) => r.user_id);
      if (!ownerIds.length) ownerIds = ["-"];
    }
    return finance.financeReport(db, { ...p, ownerIds, viewer: viewer(db, ctx) });
  },
  // Modo pacote (spec 13, Fase 4).
  "finance.requestCreate": (db: DatabaseSync, ctx: DbContext, p: { dealId: string } & finance.FinanceRequestInput) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.dealId);
    return finance.createFinanceRequest(db, ctx, p.dealId, p);
  },
  "finance.requests": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return finance.listFinanceRequests(db, p.id);
  },
  "finance.requestDiscard": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    const dealId = one<{ deal_id: string }>(db, "SELECT deal_id FROM finance_request WHERE id = ?", p.id)?.deal_id;
    if (dealId) deals.assertCardAccess(db, viewer(db, ctx), dealId);
    finance.discardFinanceRequest(db, p.id);
  },
  // Paridade de cadastros (contatos e organizações na Gestão Financeira).
  "finance.linkContact": (db: DatabaseSync, ctx: DbContext, p: { crmRef: string; sent?: boolean }) => {
    if (!contactCardFor(db, p.crmRef)) throw new ValidationError("Contato ou organização não encontrado.");
    finance.linkFinanceContact(db, ctx, p.crmRef, p.sent);
  },
  "finance.contactStatus": (db: DatabaseSync, _c: DbContext, p: { crmRef: string }) => finance.financeContactStatus(db, p.crmRef),
  "finance.pendingContacts": (db: DatabaseSync) => finance.pendingContactCards(db),
  "finance.contactsSent": (db: DatabaseSync, _c: DbContext, p: { crmRefs: string[] }) => finance.markContactsSent(db, p.crmRefs),
  "finance.requestCounts": (db: DatabaseSync) => finance.financeRequestCounts(db),
  "finance.exportPackage": (db: DatabaseSync, _c: DbContext, p: { version: string }) => finance.exportFinanceRequests(db, p.version),
  "finance.importReturn": (db: DatabaseSync, ctx: DbContext, p: { pkg: ReturnPackage }) => finance.importFinanceReturn(db, ctx, p.pkg),
  "finance.client": (db: DatabaseSync, ctx: DbContext, p: { organizationId?: string; personId?: string }) => finance.clientFinance(db, p, viewer(db, ctx)),
  "cards.import": (db: DatabaseSync, ctx: DbContext, p: cardImporter.CardImportInput) => {
    const v = viewer(db, ctx);
    return cardImporter.importCards(db, ctx, p, (ownerId) => deals.assertCanAssign(db, v, ownerId));
  },
  // Integrações (spec 09): só administradores.
  "integrations.check": (db: DatabaseSync, ctx: DbContext, p: { provider: ext.ExternalProvider; entity: ext.ExternalEntity; items: ext.ExternalCheckItem[] }) => {
    assertIntegrations(db, ctx);
    return ext.checkExternal(db, p.provider, p.entity, p.items);
  },
  "integrations.links": (db: DatabaseSync, ctx: DbContext, p: { provider: ext.ExternalProvider; entity: ext.ExternalEntity; externalIds: string[] }) => {
    assertIntegrations(db, ctx);
    return [...ext.externalLinks(db, p.provider, p.entity, p.externalIds).values()];
  },
  "integrations.refsOf": (db: DatabaseSync, _c: DbContext, p: Id) => ext.externalRefsOf(db, p.id),
  "integrations.importOrganizations": (db: DatabaseSync, ctx: DbContext, p: ext.ExternalImportInput<ext.ExternalOrganizationRow>) => {
    assertIntegrations(db, ctx);
    return ext.importExternalOrganizations(db, ctx, p);
  },
  "integrations.importPersons": (db: DatabaseSync, ctx: DbContext, p: ext.ExternalImportInput<ext.ExternalPersonRow>) => {
    assertIntegrations(db, ctx);
    return ext.importExternalPersons(db, ctx, p);
  },
  "integrations.importNotes": (db: DatabaseSync, ctx: DbContext, p: { provider: ext.ExternalProvider; rows: ext.ExternalNoteRow[] }) => {
    assertIntegrations(db, ctx);
    return ext.importExternalNotes(db, ctx, p);
  },
  "integrations.importDeals": (db: DatabaseSync, ctx: DbContext, p: ext.ExternalImportInput<ext.ExternalDealRow>) => {
    assertIntegrations(db, ctx);
    return ext.importExternalDeals(db, ctx, p);
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
  "cards.changePipeline": (db: DatabaseSync, ctx: DbContext, p: Id & { pipelineId: string; stageId?: string | null }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return deals.changeCardPipeline(db, ctx, p.id, p);
  },
  "search.global": (db: DatabaseSync, ctx: DbContext, p: { text: string }) => globalSearch(db, p.text, viewer(db, ctx)),
  "cards.counts": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return cardCounts(db, p.id);
  },
  "cards.clone": (db: DatabaseSync, ctx: DbContext, p: Id & { pipelineId: string; stageId?: string | null; title?: string | null }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return deals.cloneCard(db, ctx, p.id, p);
  },
  "cards.setStatus": (db: DatabaseSync, ctx: DbContext, p: Id & Parameters<typeof deals.setCardStatus>[3]) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    deals.setCardStatus(db, ctx, p.id, p);
  },
  "cards.setItems": (db: DatabaseSync, ctx: DbContext, p: Id & { items: deals.DealItemInput[] }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    deals.setDealItems(db, ctx, p.id, p.items);
  },
  "cards.bulk": (db: DatabaseSync, ctx: DbContext, p: { ids: string[]; action: bulk.BulkAction }) => bulk.bulkCards(db, ctx, viewer(db, ctx), p.ids, p.action),
  "cards.archive": (db: DatabaseSync, ctx: DbContext, p: Id & { archived: boolean }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    bulk.setCardArchived(db, ctx, p.id, p.archived);
  },
  "cards.contacts.add": (db: DatabaseSync, ctx: DbContext, p: Id & { personId: string }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    cardContacts.addCardContact(db, ctx, p.id, p.personId);
  },
  "cards.contacts.remove": (db: DatabaseSync, ctx: DbContext, p: Id & { personId: string }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    cardContacts.removeCardContact(db, ctx, p.id, p.personId);
  },
  "cards.contacts.setPrimary": (db: DatabaseSync, ctx: DbContext, p: Id & { personId: string }) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    cardContacts.setPrimaryCardContact(db, ctx, p.id, p.personId);
  },
  "cards.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    return deals.deleteCard(db, ctx, p.id);
  },
  "lossReasons.list": (db: DatabaseSync, _c: DbContext, p: { includeInactive?: boolean } = {}) => deals.listLossReasons(db, p),
  // Criar motivo fica liberado: o vendedor cria direto ao marcar "Perdido".
  "lossReasons.create": (db: DatabaseSync, ctx: DbContext, p: { name: string }) => deals.createLossReason(db, ctx, p.name),
  "lossReasons.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: { name?: string; active?: boolean } }) => {
    assertRole(db, ctx, MANAGERS, "motivos de perda");
    return deals.updateLossReason(db, ctx, p.id, p.patch);
  },

  // Contatos e organizações
  "persons.list": (db: DatabaseSync, ctx: DbContext, p: Omit<NonNullable<Parameters<typeof contacts.listPersons>[1]>, "viewer"> = {}) =>
    contacts.listPersons(db, { ...p, viewer: viewer(db, ctx) }),
  "persons.get": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.getPerson(db, p.id, viewer(db, ctx)),
  "persons.create": (db: DatabaseSync, ctx: DbContext, p: contacts.PersonInput) => contacts.createPerson(db, ctx, p),
  "persons.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<contacts.PersonInput> }) => {
    contacts.updatePerson(db, ctx, p.id, p.patch);
    finance.markContactChanged(db, "person", p.id); // paridade com a Gestão Financeira
  },
  "persons.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.deletePerson(db, ctx, p.id),
  "persons.findDuplicates": (db: DatabaseSync, _c: DbContext, p: Parameters<typeof contacts.findDuplicatePersons>[1]) =>
    contacts.findDuplicatePersons(db, p),
  "similar.persons": (db: DatabaseSync, ctx: DbContext, p: { name: string; excludeId?: string }) => similar.similarPersons(db, p, viewer(db, ctx)),
  "similar.organizations": (db: DatabaseSync, _c: DbContext, p: { name: string; excludeId?: string }) => similar.similarOrganizations(db, p),
  "similar.cards": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof similar.similarCards>[1]) => similar.similarCards(db, p, viewer(db, ctx)),
  "persons.setPrimaryOrganization": (db: DatabaseSync, ctx: DbContext, p: { personId: string; organizationId: string }) => {
    contacts.setPrimaryOrganization(db, ctx, p.personId, p.organizationId);
    finance.markContactChanged(db, "person", p.personId);
  },
  "organizations.list": (db: DatabaseSync, _c: DbContext, p: Parameters<typeof contacts.listOrganizations>[1] = {}) => contacts.listOrganizations(db, p),
  "organizations.get": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.getOrganization(db, p.id, viewer(db, ctx)),
  "organizations.create": (db: DatabaseSync, ctx: DbContext, p: contacts.OrganizationInput) => contacts.createOrganization(db, ctx, p),
  "organizations.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<contacts.OrganizationInput> }) => {
    contacts.updateOrganization(db, ctx, p.id, p.patch);
    finance.markContactChanged(db, "organization", p.id);
  },
  "organizations.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.deleteOrganization(db, ctx, p.id),
  "organizations.findByCnpj": (db: DatabaseSync, _c: DbContext, p: { cnpj: string }) => contacts.findOrganizationByCnpj(db, p.cnpj) ?? null,
  "organizations.segments": (db: DatabaseSync) => contacts.listSegments(db),

  "persons.count": (db: DatabaseSync, ctx: DbContext, p: Omit<contacts.PersonFilter, "viewer"> = {}) =>
    contacts.countPersons(db, { ...p, viewer: viewer(db, ctx) }),
  "persons.merge": (db: DatabaseSync, ctx: DbContext, p: { keepId: string; removeId: string }) => merge.mergePersons(db, ctx, p.keepId, p.removeId),
  "persons.import": (db: DatabaseSync, ctx: DbContext, p: { rows: importer.PersonImportRow[] }) => importer.importPersons(db, ctx, p.rows),
  "organizations.count": (db: DatabaseSync, _c: DbContext, p: contacts.OrganizationFilter = {}) => contacts.countOrganizations(db, p),
  "organizations.merge": (db: DatabaseSync, ctx: DbContext, p: { keepId: string; removeId: string }) => merge.mergeOrganizations(db, ctx, p.keepId, p.removeId),
  "organizations.import": (db: DatabaseSync, ctx: DbContext, p: { rows: importer.OrganizationImportRow[] }) => importer.importOrganizations(db, ctx, p.rows),
  "cards.forEntity": (db: DatabaseSync, ctx: DbContext, p: { personId?: string; organizationId?: string }) => deals.listCardsForEntity(db, p, viewer(db, ctx)),
  "attachments.saveImage": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof attachments.saveImage>[2]) => attachments.saveImage(db, ctx, p),
  "attachments.dataUrls": (db: DatabaseSync, _c: DbContext, p: { ids: string[] }) => attachments.getDataUrls(db, p.ids),
  // GED (spec 08)
  "documentTypes.list": (db: DatabaseSync, _c: DbContext, p: { includeInactive?: boolean } = {}) => docs.listDocumentTypes(db, p),
  // Qualquer usuário cria uma classificação ao digitar um tipo novo; editar e excluir ficam com gestores.
  "documentTypes.create": (db: DatabaseSync, ctx: DbContext, p: docs.DocumentTypeInput) => docs.createDocumentType(db, ctx, p),
  "documentTypes.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<docs.DocumentTypeInput> }) => {
    assertRole(db, ctx, MANAGERS, "tipos de documento");
    docs.updateDocumentType(db, ctx, p.id, p.patch);
  },
  "documentTypes.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertRole(db, ctx, MANAGERS, "tipos de documento");
    return docs.deleteDocumentType(db, ctx, p.id);
  },
  "documents.list": (db: DatabaseSync, ctx: DbContext, p: Omit<docs.DocumentFilter, "viewer"> = {}) => docs.listDocuments(db, { ...p, viewer: viewer(db, ctx) }),
  "documents.forEntity": (db: DatabaseSync, ctx: DbContext, p: { type: docs.DocLinkType; id: string }) => {
    assertEntityAccess(db, ctx, p.type, p.id);
    return docs.documentsFor(db, p.type, p.id, viewer(db, ctx));
  },
  /** Vínculos automáticos de quem anexa nesta tela, com rótulos. */
  "documents.contextLinks": (db: DatabaseSync, ctx: DbContext, p: { type: docs.DocLinkType; id: string }) => {
    assertEntityAccess(db, ctx, p.type, p.id);
    return docs.describeLinks(db, docs.contextLinks(db, p.type, p.id));
  },
  "documents.linkTargets": (db: DatabaseSync, ctx: DbContext, p: { q: string }) => docs.searchLinkTargets(db, p.q, viewer(db, ctx)),
  "documents.create": (db: DatabaseSync, ctx: DbContext, p: docs.DocumentInput & { file: docs.FileRef }) => {
    assertLinksAccess(db, ctx, p.links);
    return docs.createDocument(db, ctx, p);
  },
  "documents.get": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    docView(db, ctx, p.id, { includeTrash: true });
    return docs.getDocument(db, p.id) ?? null;
  },
  "documents.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<Omit<docs.DocumentInput, "links">> }) => {
    docView(db, ctx, p.id);
    if (p.patch.restricted !== undefined) docs.assertDocumentOwner(db, viewer(db, ctx), p.id);
    docs.updateDocument(db, ctx, p.id, p.patch);
  },
  /** Pastas do GED: árvore com contagens (do que quem vê pode ver). */
  "documents.folders": (db: DatabaseSync, ctx: DbContext) => docs.folderTree(db, viewer(db, ctx)),
  "documents.folderCreate": (db: DatabaseSync, ctx: DbContext, p: { name: string; parentId?: string | null }) => folders.createFolder(db, ctx, p),
  "documents.folderRename": (db: DatabaseSync, ctx: DbContext, p: Id & { name: string }) => folders.renameFolder(db, ctx, p.id, p.name),
  "documents.folderMove": (db: DatabaseSync, ctx: DbContext, p: Id & { parentId: string | null }) => folders.moveFolder(db, ctx, p.id, p.parentId),
  /** Excluir pasta: administrador ou quem criou; o conteúdo sobe para a pasta de cima. */
  "documents.folderDelete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    const v = viewer(db, ctx);
    const owner = one<{ created_by: string | null }>(db, "SELECT created_by FROM document_folder WHERE id = ?", p.id)?.created_by;
    if (v && v.role !== "admin" && owner !== v.id) throw new ValidationError("Só o administrador ou quem criou a pasta pode excluí-la.");
    return folders.deleteFolder(db, ctx, p.id);
  },
  /** Mover documentos para uma pasta (null = Sem pasta). */
  "documents.moveToFolder": (db: DatabaseSync, ctx: DbContext, p: { ids: string[]; folderId: string | null }) => {
    for (const id of p.ids) docView(db, ctx, id);
    return folders.moveDocumentsToFolder(db, ctx, p.ids, p.folderId);
  },
  /** Ações em lote: reclassificar. */
  "documents.reclassify": (db: DatabaseSync, ctx: DbContext, p: { ids: string[]; typeId: string }) => {
    for (const id of p.ids) docView(db, ctx, id);
    for (const id of p.ids) docs.updateDocument(db, ctx, id, { typeId: p.typeId });
  },
  "documents.addVersion": (db: DatabaseSync, ctx: DbContext, p: Id & { file: docs.FileRef }) => {
    docView(db, ctx, p.id);
    return docs.addDocumentVersion(db, ctx, p.id, p.file);
  },
  "documents.restoreVersion": (db: DatabaseSync, ctx: DbContext, p: Id & { versionId: string }) => {
    docView(db, ctx, p.id);
    return docs.restoreDocumentVersion(db, ctx, p.id, p.versionId);
  },
  "documents.addLinks": (db: DatabaseSync, ctx: DbContext, p: { ids: string[]; links: docs.DocLinkRef[] }) => {
    for (const id of p.ids) docView(db, ctx, id);
    assertLinksAccess(db, ctx, p.links);
    return p.ids.reduce((n, id) => n + docs.addDocumentLinks(db, ctx, id, p.links), 0);
  },
  /** "Remover deste cadastro": desfaz só este vínculo. */
  "documents.removeLink": (db: DatabaseSync, ctx: DbContext, p: Id & { type: docs.DocLinkType; entityId: string }) => {
    docView(db, ctx, p.id);
    assertEntityAccess(db, ctx, p.type, p.entityId);
    docs.removeDocumentLink(db, ctx, p.id, p.type, p.entityId);
  },
  "documents.trash": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => {
    for (const id of p.ids) {
      docView(db, ctx, id);
      docs.assertDocumentOwner(db, viewer(db, ctx), id);
    }
    return trash.mergeNotices(
      p.ids.map((id) => docs.trashDocument(db, ctx, id)),
      "documentos",
    );
  },
  "documents.restore": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => {
    for (const id of p.ids) {
      docView(db, ctx, id, { includeTrash: true });
      docs.assertDocumentOwner(db, viewer(db, ctx), id);
    }
    for (const id of p.ids) docs.restoreDocument(db, ctx, id);
  },
  /** Exclusão definitiva (administrador); devolve os arquivos a apagar. */
  "documents.purge": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => {
    assertRole(db, ctx, ADMIN, "a lixeira");
    return docs.purgeDocuments(db, ctx, p.ids);
  },
  /** Lixeira com mais de 30 dias (rotina ao abrir o GED). */
  "documents.purgeExpired": (db: DatabaseSync, ctx: DbContext) => docs.purgeDocuments(db, ctx, docs.expiredTrash(db, trash.retentionDays(db))),

  // Lixeira (spec 11)
  "trash.list": (db: DatabaseSync, ctx: DbContext, p: { entity?: string; search?: string } = {}) => trash.listTrash(db, viewer(db, ctx), p),
  "trash.count": (db: DatabaseSync, ctx: DbContext) => trash.trashCount(db, viewer(db, ctx)),
  "trash.settings": (db: DatabaseSync) => ({ days: trash.retentionDays(db) }),
  "trash.setRetention": (db: DatabaseSync, ctx: DbContext, p: { days: number }) => {
    assertRole(db, ctx, ADMIN, "o prazo da lixeira");
    trash.setRetentionDays(db, ctx, p.days);
  },
  /** Restaura cada item; um erro (ex.: funil também excluído) não impede os outros. */
  "trash.restore": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => {
    const out = { restored: 0, errors: [] as { id: string; message: string }[] };
    for (const id of p.ids) {
      try {
        trash.restoreTrashItem(db, ctx, viewer(db, ctx), id);
        out.restored++;
      } catch (e) {
        out.errors.push({ id, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  },
  /** Exclusão definitiva (administrador); devolve os arquivos de documentos a apagar. */
  "trash.purge": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => {
    assertRole(db, ctx, ADMIN, "a lixeira");
    return trash.purgeTrash(db, ctx, p.ids, (ids) => docs.purgeDocuments(db, ctx, ids));
  },
  "trash.empty": (db: DatabaseSync, ctx: DbContext) => {
    assertRole(db, ctx, ADMIN, "a lixeira");
    return trash.purgeTrash(db, ctx, trash.allTrashIds(db, null), (ids) => docs.purgeDocuments(db, ctx, ids));
  },
  /** Prazo vencido (rotina ao abrir o CRM). */
  "trash.purgeExpired": (db: DatabaseSync, ctx: DbContext) =>
    trash.purgeTrash(db, ctx, trash.expiredTrashIds(db), (ids) => docs.purgeDocuments(db, ctx, ids)),
  /** Onde ler o arquivo de uma versão; registra a visualização ou o download. */
  "documents.file": (db: DatabaseSync, ctx: DbContext, p: { versionId: string; action: docs.DocumentAction | "index" | "inline" }) => {
    const f = docs.versionFile(db, p.versionId);
    if (!f) throw new ValidationError("Arquivo não encontrado.");
    docView(db, ctx, f.document_id, { includeTrash: true });
    // "index" = leitura interna do texto do PDF; "inline" = imagem mostrada dentro
    // de uma nota (nenhuma das duas entra na auditoria).
    if (p.action !== "index" && p.action !== "inline") docs.logDocumentEvent(db, ctx, f.document_id, p.action, p.action === "download" ? f.filename : null);
    const legacy = f.location === "legacy" ? (attachments.getDataUrls(db, [f.blob_id])[f.blob_id] ?? null) : null;
    return { ...f, legacyDataUrl: legacy };
  },
  /** Quem pode receber um documento pelo WhatsApp a partir desta tela. */
  "documents.whatsappRecipients": (db: DatabaseSync, ctx: DbContext, p: { type: docs.DocLinkType; id: string }) => {
    assertEntityAccess(db, ctx, p.type, p.id);
    return docs.whatsappRecipients(db, p.type, p.id);
  },
  /** Envio pelo WhatsApp: auditoria do documento + atividade concluída no cartão/cadastro. */
  "documents.logWhatsApp": (db: DatabaseSync, ctx: DbContext, p: waLog.WhatsAppSendLog & { phoneLabel: string }) => {
    docView(db, ctx, p.documentId);
    assertEntityAccess(db, ctx, p.context.type, p.context.id);
    return waLog.logWhatsAppSend(db, ctx, p, p.phoneLabel);
  },
  /** Revisão/envio manual: prepara (pendente) e depois confirma quando a mensagem sai. */
  "documents.whatsappPrepare": (db: DatabaseSync, ctx: DbContext, p: waLog.WhatsAppSendLog & { phoneLabel: string; senderId?: string | null }) => {
    docView(db, ctx, p.documentId);
    assertEntityAccess(db, ctx, p.context.type, p.context.id);
    return waLog.prepareWhatsAppSend(db, ctx, p, p.phoneLabel);
  },
  "documents.whatsappConfirm": (
    db: DatabaseSync,
    ctx: DbContext,
    p: { sendId: string; phoneLabel: string; from?: string | null; senderId?: string | null; caption?: string | null; manual?: boolean },
  ) => {
    const c = waLog.whatsappSendContext(db, p.sendId);
    assertEntityAccess(db, ctx, c.type, c.id);
    return waLog.confirmWhatsAppSend(db, ctx, p.sendId, p);
  },
  "documents.whatsappPending": (db: DatabaseSync, ctx: DbContext, p: { type: docs.DocLinkType; id: string }) => {
    assertEntityAccess(db, ctx, p.type, p.id);
    return waLog.listPendingWhatsAppSends(db, p.type, p.id);
  },
  "documents.whatsappDiscard": (db: DatabaseSync, ctx: DbContext, p: { sendId: string }) => {
    const c = waLog.whatsappSendContext(db, p.sendId);
    assertEntityAccess(db, ctx, c.type, c.id);
    return waLog.discardWhatsAppSend(db, ctx, p.sendId);
  },
  "documents.bySha": (db: DatabaseSync, ctx: DbContext, p: { sha256: string }) => docs.documentsBySha(db, p.sha256, viewer(db, ctx)),
  /** O conteúdo já está guardado? (evita gravar de novo o mesmo arquivo). */
  "documents.blob": (db: DatabaseSync, _c: DbContext, p: { sha256: string }) => docs.blobBySha(db, p.sha256) ?? null,
  "documents.stats": (db: DatabaseSync, ctx: DbContext) => docs.documentStats(db, viewer(db, ctx)),
  "documents.audit": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    docView(db, ctx, p.id, { includeTrash: true });
    return docs.documentAudit(db, p.id);
  },
  "documents.expiring": (db: DatabaseSync, ctx: DbContext, p: { days: number }) => docs.expiringDocuments(db, p.days, viewer(db, ctx)),
  // Manutenção do depósito de arquivos (feita pelas telas).
  "files.inBrowser": (db: DatabaseSync) => docs.browserBlobs(db),
  "files.setLocation": (db: DatabaseSync, ctx: DbContext, p: { blobId: string; location: "browser" | "folder"; path: string | null }) =>
    docs.setBlobLocation(db, ctx, p.blobId, p.location, p.path),
  "files.all": (db: DatabaseSync) => docs.allBlobs(db),
  "files.markInBrowser": (db: DatabaseSync, ctx: DbContext, p: { sha256s: string[] }) => docs.markInBrowser(db, ctx, p.sha256s),
  "files.pendingText": (db: DatabaseSync) => docs.pendingTextVersions(db),
  "files.setText": (db: DatabaseSync, ctx: DbContext, p: { versionId: string; text: string | null }) => docs.setVersionText(db, ctx, p.versionId, p.text),
  "persons.findByPhone": (db: DatabaseSync, ctx: DbContext, p: { phone: string }) => contacts.findPersonsByPhone(db, p.phone, viewer(db, ctx)),

  // Tarefas
  "activityTypes.list": (db: DatabaseSync, _c: DbContext, p: { includeInactive?: boolean } = {}) => activities.listActivityTypes(db, p),
  "activityTypes.create": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof activities.createActivityType>[2]) => {
    assertRole(db, ctx, MANAGERS, "tipos de atividade");
    return activities.createActivityType(db, ctx, p);
  },
  "activityTypes.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Parameters<typeof activities.updateActivityType>[3] }) => {
    assertRole(db, ctx, MANAGERS, "tipos de atividade");
    return activities.updateActivityType(db, ctx, p.id, p.patch);
  },
  "activities.list": (db: DatabaseSync, ctx: DbContext, p: Omit<activities.ActivityFilter, "viewer"> = {}) =>
    activities.listActivities(db, { ...p, viewer: viewer(db, ctx) }),
  "activities.counters": (db: DatabaseSync, ctx: DbContext, p: Omit<activities.ActivityFilter, "viewer" | "from" | "to" | "done" | "overdue"> = {}) =>
    activities.activityCounters(db, { ...p, viewer: viewer(db, ctx) }),
  /** Usado pelo service worker (lembretes). */
  "activities.dueReminders": (db: DatabaseSync, ctx: DbContext) => activities.dueReminders(db, ctx.userId),
  "activities.markReminded": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => activities.markReminded(db, ctx, p.ids),
  // Notificações (spec 10): o service worker pergunta o que avisar e registra o resultado.
  "notifications.plan": (db: DatabaseSync, ctx: DbContext, p: { settings: Record<string, Partial<NotifySettings>>; now?: string; finance?: boolean }) => {
    const now = p.now ? new Date(p.now) : new Date();
    // Atividades recorrentes: completa a janela de dias à frente (no máximo a cada 3 h).
    if (now.getTime() - lastSeriesTopUp > 3 * 3600_000) {
      lastSeriesTopUp = now.getTime();
      series.topUpAllSeries(db, ctx, now);
    }
    return notify.planNotifications(db, now, p.settings, ctx.userId, !!p.finance);
  },
  "notifications.record": (db: DatabaseSync, _c: DbContext, p: { results: Parameters<typeof notify.recordDeliveries>[1] }) => notify.recordDeliveries(db, p.results),
  "notifications.forActivity": (db: DatabaseSync, _c: DbContext, p: Id) => notify.activityDeliveries(db, p.id),
  "activities.setExternalEvent": (db: DatabaseSync, ctx: DbContext, p: Id & Parameters<typeof activities.setActivityExternalEvent>[3]) => {
    assertActivityAccess(db, ctx, p.id);
    activities.setActivityExternalEvent(db, ctx, p.id, p);
  },
  "cards.search": (db: DatabaseSync, ctx: DbContext, p: { search: string }) => deals.searchCards(db, p.search, viewer(db, ctx)),
  "activities.get": (db: DatabaseSync, _c: DbContext, p: Id) => activities.getActivity(db, p.id),
  /** Com `recurrence`: cria a série e devolve a 1ª ocorrência (spec 02, recorrentes). */
  "activities.create": (
    db: DatabaseSync,
    ctx: DbContext,
    p: activities.ActivityInput & { recurrence?: RecurrenceRule | null; contactMessage?: contactMsg.ContactMessageInput | null },
  ) => {
    const { recurrence, contactMessage, ...input } = p;
    if (recurrence) return series.createSeries(db, ctx, { ...input, recurrence, ...(contactMessage ? { contactMessage } : {}) }).firstId ?? "";
    return withTransaction(db, () => {
      const id = activities.createActivity(db, ctx, input);
      if (contactMessage) contactMsg.setContactMessage(db, ctx, id, contactMessage);
      return id;
    });
  },
  /** `scope` (ocorrência de série): "this" (padrão), "following" ou "all"; `recurrence` muda a regra. */
  "activities.update": (
    db: DatabaseSync,
    ctx: DbContext,
    p: Id & {
      patch: Partial<activities.ActivityInput>;
      scope?: series.SeriesScope;
      recurrence?: RecurrenceRule | null;
      /** Lembrete para o contato: objeto liga/altera, null desliga, ausente não mexe. */
      contactMessage?: contactMsg.ContactMessageInput | null;
    },
  ) => {
    assertActivityAccess(db, ctx, p.id);
    if (p.contactMessage !== undefined) {
      if (p.scope && p.scope !== "this") series.setSeriesContactMessage(db, ctx, p.id, p.scope, p.contactMessage);
      else contactMsg.setContactMessage(db, ctx, p.id, p.contactMessage);
    }
    if (p.scope && p.scope !== "this") {
      const { done, ...rest } = p.patch;
      series.updateSeries(db, ctx, p.id, p.scope, rest, p.recurrence ?? undefined);
      if (done !== undefined && one(db, "SELECT 1 FROM activity WHERE id = ? AND deleted_at IS NULL", p.id)) activities.setActivityDone(db, ctx, p.id, done);
    } else if (p.recurrence && !one<{ s: string | null }>(db, "SELECT series_id AS s FROM activity WHERE id = ?", p.id)?.s) {
      // Atividade comum que passou a repetir: vira a 1ª da série.
      activities.updateActivity(db, ctx, p.id, p.patch);
      series.makeRecurring(db, ctx, p.id, p.recurrence);
    } else activities.updateActivity(db, ctx, p.id, p.patch);
    if (p.patch.done) series.afterOccurrenceDone(db, ctx, p.id);
  },
  "activities.setDone": (db: DatabaseSync, ctx: DbContext, p: Id & { done: boolean }) => {
    assertActivityAccess(db, ctx, p.id);
    activities.setActivityDone(db, ctx, p.id, p.done);
    if (p.done) series.afterOccurrenceDone(db, ctx, p.id);
  },
  /** Ocorrência de série: `scope` "this" (padrão), "following" ou "all". */
  "activities.delete": (db: DatabaseSync, ctx: DbContext, p: Id & { scope?: series.SeriesScope }) => {
    assertActivityAccess(db, ctx, p.id);
    return p.scope ? series.deleteFromSeries(db, ctx, p.id, p.scope) : series.deleteActivityOrOccurrence(db, ctx, p.id);
  },
  /** Lembrete para o contato: quem pode receber, empresa do funil e o lembrete atual (com a prévia). */
  "contactMessages.context": (db: DatabaseSync, ctx: DbContext, p: { activityId?: string | null; personId?: string | null; dealId?: string | null }) => {
    if (p.activityId) assertActivityAccess(db, ctx, p.activityId);
    return {
      recipients: contactMsg.contactRecipients(db, p),
      company: contactMsg.companyForDeal(db, p.dealId),
      current: p.activityId ? contactMsg.contactMessagePreview(db, p.activityId) : null,
    };
  },
  /** Service worker: o que enviar agora (e o que passou da hora). */
  "contactMessages.due": (db: DatabaseSync, ctx: DbContext, p: { now?: string }) => contactMsg.dueContactMessages(db, ctx, p.now ? new Date(p.now) : new Date()),
  "contactMessages.record": (db: DatabaseSync, ctx: DbContext, p: { id: string; ok: boolean; text?: string; error?: string }) =>
    contactMsg.recordContactMessage(db, ctx, p.id, p),
  /** Regra da recorrência de uma atividade (null = não repete). */
  "activities.series": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertActivityAccess(db, ctx, p.id);
    return series.seriesOfActivity(db, p.id);
  },
  "activities.endSeries": (db: DatabaseSync, ctx: DbContext, p: Id & { date: string }) => {
    assertActivityAccess(db, ctx, p.id);
    const s = series.seriesOfActivity(db, p.id);
    if (!s) throw new ValidationError("Esta atividade não faz parte de uma recorrência.");
    return series.endSeries(db, ctx, s.id, p.date);
  },

  // Relatórios (respeitam a permissão do usuário)
  "reports.get": (db: DatabaseSync, ctx: DbContext, p: { from: string; to: string; pipelineId?: string | null; ownerId?: string | null; teamId?: string | null }) => {
    let ownerIds: string[] | null = null;
    if (p.ownerId) ownerIds = [p.ownerId];
    else if (p.teamId) {
      ownerIds = many<{ user_id: string }>(db, "SELECT user_id FROM team_member WHERE team_id = ? AND deleted_at IS NULL", p.teamId).map((r) => r.user_id);
      if (!ownerIds.length) ownerIds = ["-"];
    }
    return reports.buildReport(db, { from: p.from, to: p.to, pipelineId: p.pipelineId, ownerIds, viewer: viewer(db, ctx) });
  },

  // Copiloto de IA: consultas prontas, sempre com a permissão do usuário
  "copilot.searchCards": (db: DatabaseSync, ctx: DbContext, p: copilot.CardSearch) => copilot.searchCardsForCopilot(db, viewer(db, ctx), p),
  "copilot.card": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    const d = copilot.cardDigest(db, viewer(db, ctx), p.id);
    return "erro" in d ? d : { ...d, financeiro: copilot.cardFinanceForCopilot(db, p.id) };
  },
  "copilot.finance": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof copilot.financeSummaryForCopilot>[2]) => copilot.financeSummaryForCopilot(db, viewer(db, ctx), p),
  "copilot.financeAlerts": (db: DatabaseSync, ctx: DbContext, p: { responsavel?: string }) => copilot.financeAlertsForCopilot(db, viewer(db, ctx), p),
  "copilot.stale": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof copilot.staleDeals>[2]) => copilot.staleDeals(db, viewer(db, ctx), p),
  "copilot.tasks": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof copilot.tasksForCopilot>[2]) => copilot.tasksForCopilot(db, viewer(db, ctx), p),
  "copilot.contacts": (db: DatabaseSync, ctx: DbContext, p: { texto: string }) => copilot.contactsForCopilot(db, viewer(db, ctx), p.texto),
  /** GED para o Copiloto: busca por texto e/ou pasta (com subpastas); sem nada, as pastas. */
  "copilot.documents": (db: DatabaseSync, ctx: DbContext, p: { texto?: string; pasta?: string }) => {
    const tree = docs.folderTree(db, viewer(db, ctx));
    const pastas = tree.folders.map((f) => ({ pasta: f.path.join(" › "), documentos: f.total }));
    let folderId: string | undefined;
    if (p.pasta?.trim()) {
      const want = normalizeText(p.pasta).split(/\s*[/›>]\s*/).filter(Boolean).join("/");
      const match = (f: docs.FolderNode) => normalizeText(f.path.join("/")) === want || normalizeText(f.name) === want.split("/").at(-1);
      const found = tree.folders.filter(match).sort((a, b) => a.path.length - b.path.length)[0];
      if (!found) return { erro: `Pasta não encontrada: ${p.pasta}`, pastas };
      folderId = found.id;
    }
    if (!folderId && !p.texto?.trim()) return { pastas, sem_pasta: tree.none };
    const r = docs.listDocuments(db, { search: p.texto, folderId, folderDeep: true, viewer: viewer(db, ctx), limit: 30 });
    return {
      total: r.total,
      documentos: r.items.map((d) => ({
        nome: d.name,
        classificacao: d.type_name ?? "Não classificado",
        pasta: d.folder_path.join(" › ") || "Sem pasta",
        vinculos: d.links.map((l) => l.label),
        validade: d.valid_until,
        enviado_em: d.created_at.slice(0, 10),
        enviado_por: d.created_by_name,
      })),
    };
  },
  "copilot.structure": (db: DatabaseSync) => copilot.crmStructure(db),
  "copilot.summary": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof copilot.salesSummary>[2]) => copilot.salesSummary(db, viewer(db, ctx), p),

  // Notas
  "notes.list": (db: DatabaseSync, _c: DbContext, p: { entityType: notes.NoteEntity; entityId: string }) => notes.listNotes(db, p.entityType, p.entityId),
  "notes.add": (db: DatabaseSync, ctx: DbContext, p: { entityType: notes.NoteEntity; entityId: string; body: string; documentIds?: string[] }) =>
    notes.addNote(db, ctx, p.entityType, p.entityId, p.body, p.documentIds),
  "notes.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: { body?: string; pinned?: boolean; documentIds?: string[] } }) => notes.updateNote(db, ctx, p.id, p.patch),
  "notes.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => notes.deleteNote(db, ctx, p.id),

  // Tags
  "tags.list": (db: DatabaseSync, _c: DbContext, p: { entity: tags.TagEntity; includeInactive?: boolean }) => tags.listTags(db, p.entity, p),
  "tags.create": (db: DatabaseSync, ctx: DbContext, p: { entity: tags.TagEntity; name: string; color?: string }) => tags.createTag(db, ctx, p),
  "tags.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: { name?: string; color?: string; active?: boolean } }) => {
    assertRole(db, ctx, ADMIN, "tags");
    return tags.updateTag(db, ctx, p.id, p.patch);
  },
  "tags.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertRole(db, ctx, ADMIN, "tags");
    return tags.deleteTag(db, ctx, p.id);
  },

  // Campos personalizados
  "customFields.list": (db: DatabaseSync, _c: DbContext, p: { entity: cf.CustomFieldEntity; pipelineId?: string; includeInactive?: boolean }) =>
    cf.listCustomFields(db, p.entity, p),
  "customFields.create": (db: DatabaseSync, ctx: DbContext, p: cf.CustomFieldInput) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    return cf.createCustomField(db, ctx, p);
  },
  "customFields.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Parameters<typeof cf.updateCustomField>[3] }) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    return cf.updateCustomField(db, ctx, p.id, p.patch);
  },
  "customFields.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    return cf.deleteCustomField(db, ctx, p.id);
  },

  "customFields.usage": (db: DatabaseSync, _c: DbContext, p: Id) => cf.customFieldUsage(db, p.id),
  "fieldGroups.list": (db: DatabaseSync, _c: DbContext, p: { entity: cf.CustomFieldEntity }) => cf.listFieldGroups(db, p.entity),
  "fieldGroups.create": (db: DatabaseSync, ctx: DbContext, p: { entity: cf.CustomFieldEntity; name: string }) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    return cf.createFieldGroup(db, ctx, p);
  },
  "fieldGroups.rename": (db: DatabaseSync, ctx: DbContext, p: Id & { name: string }) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    cf.renameFieldGroup(db, ctx, p.id, p.name);
  },
  "fieldGroups.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    return cf.deleteFieldGroup(db, ctx, p.id);
  },
  "fieldGroups.reorder": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    cf.reorderFieldGroups(db, ctx, p.ids);
  },
  "customFields.reorder": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    cf.reorderCustomFields(db, ctx, p.ids);
  },
  "tags.usage": (db: DatabaseSync, _c: DbContext, p: { entity: tags.TagEntity }) => tags.tagUsage(db, p.entity),
  "products.usage": (db: DatabaseSync) => products.productUsage(db),

  // Produtos e serviços
  "products.customValues": (db: DatabaseSync, _c: DbContext, p: Id) => products.productCustomValues(db, p.id),
  "products.list": (db: DatabaseSync, _c: DbContext, p: Parameters<typeof products.listProducts>[1] = {}) => products.listProducts(db, p),
  "products.create": (db: DatabaseSync, ctx: DbContext, p: products.ProductInput) => {
    assertRole(db, ctx, MANAGERS, "produtos");
    return products.createProduct(db, ctx, p);
  },
  "products.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<products.ProductInput> }) => {
    assertRole(db, ctx, MANAGERS, "produtos");
    return products.updateProduct(db, ctx, p.id, p.patch);
  },
  "products.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertRole(db, ctx, MANAGERS, "produtos");
    return products.deleteProduct(db, ctx, p.id);
  },
  "productCategories.list": (db: DatabaseSync) => products.listProductCategories(db),
  "productCategories.create": (db: DatabaseSync, ctx: DbContext, p: { name: string }) => {
    assertRole(db, ctx, MANAGERS, "produtos");
    return products.createProductCategory(db, ctx, p.name);
  },
  "productCategories.rename": (db: DatabaseSync, ctx: DbContext, p: Id & { name: string }) => {
    assertRole(db, ctx, MANAGERS, "produtos");
    return products.renameProductCategory(db, ctx, p.id, p.name);
  },
  "productCategories.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertRole(db, ctx, MANAGERS, "produtos");
    return products.deleteProductCategory(db, ctx, p.id);
  },
} satisfies Record<string, Handler>;

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type MethodParams<M extends MethodName> = Parameters<Methods[M]>[2];
export type MethodResult<M extends MethodName> = Awaited<ReturnType<Methods[M]>>;
