import { describe, expect, it } from "vitest";
import { createTeam, createUser, listTeams, listUsers, setTeamMembers, teammateIds, updateUser, userLabel } from "../src/db/users";
import { freshDb } from "./helpers";

describe("usuários e equipes", () => {
  it("o primeiro usuário precisa ser administrador", async () => {
    const { db, ctx } = await freshDb();
    expect(() => createUser(db, ctx, { name: "Ana", role: "vendedor" })).toThrow(/primeiro usuário/);
    createUser(db, ctx, { name: "Antenor", role: "admin" });
    expect(() => createUser(db, ctx, { name: "Ana", role: "vendedor" })).not.toThrow();
  });

  it("mostra o tipo ao lado do nome, e (Você) para o usuário atual", async () => {
    const { db, ctx } = await freshDb();
    const me = createUser(db, ctx, { name: "Antenor", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const byId = Object.fromEntries(listUsers(db).map((u) => [u.id, u]));
    expect(userLabel(byId[me]!, me)).toBe("Antenor (Você)");
    expect(userLabel(byId[ana]!, me)).toBe("Ana (vendedor)");
    expect(userLabel(byId[me]!, ana)).toBe("Antenor (administrador)");
  });

  it("mantém pelo menos um administrador ativo", async () => {
    const { db, ctx } = await freshDb();
    const admin = createUser(db, ctx, { name: "Antenor", role: "admin" });
    expect(() => updateUser(db, ctx, admin, { role: "gestor" })).toThrow(/administrador ativo/);
    expect(() => updateUser(db, ctx, admin, { active: false })).toThrow(/administrador ativo/);
    createUser(db, ctx, { name: "Maria", role: "admin" });
    expect(() => updateUser(db, ctx, admin, { role: "gestor" })).not.toThrow();
  });

  it("inativos saem da lista padrão", async () => {
    const { db, ctx } = await freshDb();
    createUser(db, ctx, { name: "Antenor", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    updateUser(db, ctx, ana, { active: false });
    expect(listUsers(db).map((u) => u.name)).toEqual(["Antenor"]);
    expect(listUsers(db, { includeInactive: true })).toHaveLength(2);
  });

  it("equipes definem a visão 'Minha equipe'", async () => {
    const { db, ctx } = await freshDb();
    const gestor = createUser(db, ctx, { name: "Gestor", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const bia = createUser(db, ctx, { name: "Bia", role: "vendedor" });
    const caio = createUser(db, ctx, { name: "Caio", role: "vendedor" });
    const team = createTeam(db, ctx, { name: "Vendas SP", members: [{ userId: gestor, isLeader: true }, { userId: ana }] });
    expect(teammateIds(db, ana).sort()).toEqual([gestor, ana].sort());
    setTeamMembers(db, ctx, team, [{ userId: gestor, isLeader: true }, { userId: bia }]);
    expect(teammateIds(db, ana)).toEqual([ana]);
    expect(teammateIds(db, gestor).sort()).toEqual([gestor, bia].sort());
    expect(teammateIds(db, caio)).toEqual([caio]);
    expect(listTeams(db)[0]!.members).toEqual(
      expect.arrayContaining([{ userId: gestor, isLeader: true }, { userId: bia, isLeader: false }]),
    );
  });
});
