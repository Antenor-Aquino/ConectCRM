// Usuários (Administrador, Gestor, Vendedor) e equipes - cadastros locais
// para atribuição e controle (PLANEJAMENTO.md, seção 5).
import { normalizeEmail, requireText, ValidationError } from "../lib/validate";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export type Role = "admin" | "gestor" | "vendedor";

export const ROLE_LABEL: Record<Role, string> = { admin: "administrador", gestor: "gestor", vendedor: "vendedor" };

export interface User {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  color: string | null;
  active: number;
  /** 1 se o usuário tem PIN definido (o hash nunca sai do banco). */
  has_pin: number;
  version: number;
}

/** Quem está vendo a tela - define visibilidade (contato privado, "Minha equipe"). */
export interface Viewer {
  id: string;
  role: Role;
}

/** "Antenor (Você)" para o usuário atual; "Antenor (vendedor)" para os demais (spec 01, seção 7). */
export function userLabel(user: Pick<User, "id" | "name" | "role">, currentUserId: string | null): string {
  return `${user.name} (${user.id === currentUserId ? "Você" : ROLE_LABEL[user.role]})`;
}

const USER_COLS = "id, name, email, role, color, active, (pin_hash IS NOT NULL) AS has_pin, version";

export function listUsers(db: DatabaseSync, opts: { includeInactive?: boolean } = {}): User[] {
  return many<User>(
    db,
    `SELECT ${USER_COLS} FROM app_user WHERE deleted_at IS NULL ${opts.includeInactive ? "" : "AND active = 1"}
     ORDER BY name COLLATE NOCASE`,
  );
}

export function getUser(db: DatabaseSync, id: string): User | undefined {
  return one<User>(db, `SELECT ${USER_COLS} FROM app_user WHERE id = ? AND deleted_at IS NULL`, id);
}

export function getViewer(db: DatabaseSync, userId: string | null): Viewer | null {
  if (!userId) return null;
  const u = getUser(db, userId);
  return u && u.active ? { id: u.id, role: u.role } : null;
}

export interface UserInput {
  name: string;
  email?: string | null;
  role: Role;
  color?: string | null;
}

function checkRole(role: string): asserts role is Role {
  if (!(role in ROLE_LABEL)) throw new ValidationError("Tipo de usuário inválido.");
}

function activeAdminCount(db: DatabaseSync, exceptId?: string): number {
  return (
    one<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM app_user WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id <> ?",
      exceptId ?? "",
    )?.n ?? 0
  );
}

export function createUser(db: DatabaseSync, ctx: DbContext, input: UserInput): string {
  checkRole(input.role);
  const name = requireText(input.name, "Informe o nome do usuário.");
  if (listUsers(db, { includeInactive: true }).length === 0 && input.role !== "admin") {
    throw new ValidationError("O primeiro usuário precisa ser administrador.");
  }
  return insertRow(db, ctx, "app_user", { name, email: normalizeEmail(input.email), role: input.role, color: input.color ?? null });
}

export function updateUser(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<UserInput> & { active?: boolean }): void {
  withTransaction(db, () => {
    const current = getUser(db, id);
    if (!current) throw new ValidationError("Usuário não encontrado.");
    const data: Record<string, string | number | null> = {};
    if (patch.name !== undefined) data.name = requireText(patch.name, "Informe o nome do usuário.");
    if (patch.email !== undefined) data.email = normalizeEmail(patch.email);
    if (patch.color !== undefined) data.color = patch.color;
    if (patch.role !== undefined) {
      checkRole(patch.role);
      data.role = patch.role;
    }
    if (patch.active !== undefined) data.active = patch.active ? 1 : 0;
    const losesAdmin = current.role === "admin" && current.active && ((data.role !== undefined && data.role !== "admin") || data.active === 0);
    if (losesAdmin && activeAdminCount(db, id) === 0) {
      throw new ValidationError("É preciso manter pelo menos um administrador ativo.");
    }
    updateRow(db, ctx, "app_user", id, data);
  });
}

// ---------- Equipes ----------

export interface Team {
  id: string;
  name: string;
  active: number;
  members: { userId: string; isLeader: boolean }[];
}

export function listTeams(db: DatabaseSync): Team[] {
  const teams = many<{ id: string; name: string; active: number }>(
    db,
    "SELECT id, name, active FROM team WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
  );
  const members = many<{ team_id: string; user_id: string; is_leader: number }>(
    db,
    "SELECT team_id, user_id, is_leader FROM team_member WHERE deleted_at IS NULL",
  );
  return teams.map((t) => ({
    ...t,
    members: members.filter((m) => m.team_id === t.id).map((m) => ({ userId: m.user_id, isLeader: m.is_leader === 1 })),
  }));
}

export function createTeam(db: DatabaseSync, ctx: DbContext, input: { name: string; members?: { userId: string; isLeader?: boolean }[] }): string {
  return withTransaction(db, () => {
    const id = insertRow(db, ctx, "team", { name: requireText(input.name, "Informe o nome da equipe.") });
    setTeamMembers(db, ctx, id, input.members ?? []);
    return id;
  });
}

export function renameTeam(db: DatabaseSync, ctx: DbContext, id: string, name: string): void {
  updateRow(db, ctx, "team", id, { name: requireText(name, "Informe o nome da equipe.") });
}

export function deleteTeam(db: DatabaseSync, ctx: DbContext, id: string): void {
  withTransaction(db, () => {
    setTeamMembers(db, ctx, id, []);
    softDelete(db, ctx, "team", id);
  });
}

/** Substitui os membros da equipe (adiciona, remove e atualiza líder). */
export function setTeamMembers(db: DatabaseSync, ctx: DbContext, teamId: string, members: { userId: string; isLeader?: boolean }[]): void {
  withTransaction(db, () => {
    const current = many<{ id: string; user_id: string; is_leader: number }>(
      db,
      "SELECT id, user_id, is_leader FROM team_member WHERE team_id = ? AND deleted_at IS NULL",
      teamId,
    );
    const wanted = new Map(members.map((m) => [m.userId, m.isLeader ? 1 : 0]));
    for (const row of current) {
      const leader = wanted.get(row.user_id);
      if (leader === undefined) softDelete(db, ctx, "team_member", row.id);
      else updateRow(db, ctx, "team_member", row.id, { is_leader: leader });
      wanted.delete(row.user_id);
    }
    for (const [userId, isLeader] of wanted) {
      if (!getUser(db, userId)) throw new ValidationError("Usuário não encontrado.");
      insertRow(db, ctx, "team_member", { team_id: teamId, user_id: userId, is_leader: isLeader });
    }
  });
}

/** Usuários que compartilham alguma equipe com `userId` (inclui ele) - visão "Minha equipe". */
export function teammateIds(db: DatabaseSync, userId: string): string[] {
  const rows = many<{ user_id: string }>(
    db,
    `SELECT DISTINCT m2.user_id FROM team_member m1
     JOIN team_member m2 ON m2.team_id = m1.team_id AND m2.deleted_at IS NULL
     JOIN team t ON t.id = m1.team_id AND t.deleted_at IS NULL
     WHERE m1.user_id = ? AND m1.deleted_at IS NULL`,
    userId,
  );
  const ids = new Set(rows.map((r) => r.user_id));
  ids.add(userId);
  return [...ids];
}

// ---------- PIN ----------
// O hash é calculado fora (lib/pin.ts, assíncrono); aqui só grava/lê.

export function setUserPinHash(db: DatabaseSync, ctx: DbContext, id: string, pinHash: string | null): void {
  if (!getUser(db, id)) throw new ValidationError("Usuário não encontrado.");
  updateRow(db, ctx, "app_user", id, { pin_hash: pinHash });
}

export function getUserPinHash(db: DatabaseSync, id: string): string | null {
  return one<{ pin_hash: string | null }>(db, "SELECT pin_hash FROM app_user WHERE id = ? AND deleted_at IS NULL", id)?.pin_hash ?? null;
}
