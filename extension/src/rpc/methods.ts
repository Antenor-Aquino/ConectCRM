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
import * as ext from "../db/externalImport";
import * as merge from "../db/merge";
import * as contacts from "../db/contacts";
import * as copilot from "../db/copilot";
import * as cf from "../db/customFields";
import * as deals from "../db/deals";
import * as docs from "../db/documents";
import * as notes from "../db/notes";
import * as pipelines from "../db/pipelines";
import * as products from "../db/products";
import * as reports from "../db/reports";
import * as similar from "../db/similar";
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
  "cards.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    deals.assertCardAccess(db, viewer(db, ctx), p.id);
    deals.deleteCard(db, ctx, p.id);
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
  "persons.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<contacts.PersonInput> }) => contacts.updatePerson(db, ctx, p.id, p.patch),
  "persons.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => contacts.deletePerson(db, ctx, p.id),
  "persons.findDuplicates": (db: DatabaseSync, _c: DbContext, p: Parameters<typeof contacts.findDuplicatePersons>[1]) =>
    contacts.findDuplicatePersons(db, p),
  "similar.persons": (db: DatabaseSync, ctx: DbContext, p: { name: string; excludeId?: string }) => similar.similarPersons(db, p, viewer(db, ctx)),
  "similar.organizations": (db: DatabaseSync, _c: DbContext, p: { name: string; excludeId?: string }) => similar.similarOrganizations(db, p),
  "similar.cards": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof similar.similarCards>[1]) => similar.similarCards(db, p, viewer(db, ctx)),
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
    docs.deleteDocumentType(db, ctx, p.id);
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
    for (const id of p.ids) docs.trashDocument(db, ctx, id);
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
  "documents.purgeExpired": (db: DatabaseSync, ctx: DbContext) => docs.purgeDocuments(db, ctx, docs.expiredTrash(db)),
  /** Onde ler o arquivo de uma versão; registra a visualização ou o download. */
  "documents.file": (db: DatabaseSync, ctx: DbContext, p: { versionId: string; action: docs.DocumentAction | "index" }) => {
    const f = docs.versionFile(db, p.versionId);
    if (!f) throw new ValidationError("Arquivo não encontrado.");
    docView(db, ctx, f.document_id, { includeTrash: true });
    // "index" = leitura interna do texto do PDF (não entra na auditoria).
    if (p.action !== "index") docs.logDocumentEvent(db, ctx, f.document_id, p.action, p.action === "download" ? f.filename : null);
    const legacy = f.location === "legacy" ? (attachments.getDataUrls(db, [f.blob_id])[f.blob_id] ?? null) : null;
    return { ...f, legacyDataUrl: legacy };
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
  "activities.setExternalEvent": (db: DatabaseSync, ctx: DbContext, p: Id & Parameters<typeof activities.setActivityExternalEvent>[3]) => {
    assertActivityAccess(db, ctx, p.id);
    activities.setActivityExternalEvent(db, ctx, p.id, p);
  },
  "cards.search": (db: DatabaseSync, ctx: DbContext, p: { search: string }) => deals.searchCards(db, p.search, viewer(db, ctx)),
  "activities.get": (db: DatabaseSync, _c: DbContext, p: Id) => activities.getActivity(db, p.id),
  "activities.create": (db: DatabaseSync, ctx: DbContext, p: activities.ActivityInput) => activities.createActivity(db, ctx, p),
  "activities.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: Partial<activities.ActivityInput> }) => {
    assertActivityAccess(db, ctx, p.id);
    activities.updateActivity(db, ctx, p.id, p.patch);
  },
  "activities.setDone": (db: DatabaseSync, ctx: DbContext, p: Id & { done: boolean }) => {
    assertActivityAccess(db, ctx, p.id);
    activities.setActivityDone(db, ctx, p.id, p.done);
  },
  "activities.delete": (db: DatabaseSync, ctx: DbContext, p: Id) => {
    assertActivityAccess(db, ctx, p.id);
    activities.deleteActivity(db, ctx, p.id);
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
  "copilot.card": (db: DatabaseSync, ctx: DbContext, p: Id) => copilot.cardDigest(db, viewer(db, ctx), p.id),
  "copilot.stale": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof copilot.staleDeals>[2]) => copilot.staleDeals(db, viewer(db, ctx), p),
  "copilot.tasks": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof copilot.tasksForCopilot>[2]) => copilot.tasksForCopilot(db, viewer(db, ctx), p),
  "copilot.contacts": (db: DatabaseSync, ctx: DbContext, p: { texto: string }) => copilot.contactsForCopilot(db, viewer(db, ctx), p.texto),
  "copilot.structure": (db: DatabaseSync) => copilot.crmStructure(db),
  "copilot.summary": (db: DatabaseSync, ctx: DbContext, p: Parameters<typeof copilot.salesSummary>[2]) => copilot.salesSummary(db, viewer(db, ctx), p),

  // Notas
  "notes.list": (db: DatabaseSync, _c: DbContext, p: { entityType: notes.NoteEntity; entityId: string }) => notes.listNotes(db, p.entityType, p.entityId),
  "notes.add": (db: DatabaseSync, ctx: DbContext, p: { entityType: notes.NoteEntity; entityId: string; body: string; documentIds?: string[] }) =>
    notes.addNote(db, ctx, p.entityType, p.entityId, p.body, p.documentIds),
  "notes.update": (db: DatabaseSync, ctx: DbContext, p: Id & { patch: { body?: string; pinned?: boolean } }) => notes.updateNote(db, ctx, p.id, p.patch),
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
  "customFields.reorder": (db: DatabaseSync, ctx: DbContext, p: { ids: string[] }) => {
    assertRole(db, ctx, ADMIN, "campos personalizados");
    cf.reorderCustomFields(db, ctx, p.ids);
  },
  "tags.usage": (db: DatabaseSync, _c: DbContext, p: { entity: tags.TagEntity }) => tags.tagUsage(db, p.entity),
  "products.usage": (db: DatabaseSync) => products.productUsage(db),

  // Produtos e serviços
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
