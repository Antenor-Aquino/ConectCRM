import { describe, expect, it } from "vitest";
import { createUser, listUsers } from "../src/db/users";
import { hashPin, isValidPin, verifyPin } from "../src/lib/pin";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

describe("PIN", () => {
  it("só 4 a 6 números; hash com sal (dois hashes do mesmo PIN diferem)", async () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("1234567")).toBe(false);
    await expect(hashPin("12")).rejects.toThrow(/4 a 6/);
    const a = await hashPin("1234");
    const b = await hashPin("1234");
    expect(a).not.toBe(b);
    expect(a).not.toContain("1234$");
    expect(await verifyPin("1234", a)).toBe(true);
    expect(await verifyPin("4321", a)).toBe(false);
    expect(await verifyPin("qualquer", null)).toBe(true);
  });

  it("definir, conferir e remover pelo RPC; o hash nunca sai do banco", async () => {
    const { db, ctx } = await freshDb();
    const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const asAna = { ...ctx, userId: ana };
    await methods["users.setPin"](db, asAna, { id: ana, pin: "2468" });
    expect(listUsers(db).find((u) => u.id === ana)).toMatchObject({ has_pin: 1 });
    expect(JSON.stringify(listUsers(db))).not.toContain("pbkdf2");
    expect(await methods["users.verifyPin"](db, ctx, { id: ana, pin: "2468" })).toBe(true);
    // vendedora não mexe no PIN de outro usuário; administrador remove
    await expect(methods["users.setPin"](db, asAna, { id: admin, pin: "1111" })).rejects.toThrow(/administradores/);
    await methods["users.setPin"](db, { ...ctx, userId: admin }, { id: ana, pin: null });
    expect(listUsers(db).find((u) => u.id === ana)!.has_pin).toBe(0);
  });
});

describe("cadastro de usuários e equipes só por administrador", () => {
  it("primeiro usuário sem login; depois só administrador cria", async () => {
    const { db, ctx } = await freshDb();
    const admin = methods["users.create"](db, ctx, { name: "Admin", role: "admin" });
    const ana = methods["users.create"](db, { ...ctx, userId: admin }, { name: "Ana", role: "vendedor" });
    expect(() => methods["users.create"](db, { ...ctx, userId: ana }, { name: "X", role: "vendedor" })).toThrow(/administradores/);
    expect(() => methods["users.create"](db, ctx, { name: "X", role: "vendedor" })).toThrow(/administradores/);
  });

  it("usuário edita o próprio nome, mas não o próprio tipo", async () => {
    const { db, ctx } = await freshDb();
    const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    methods["users.update"](db, { ...ctx, userId: ana }, { id: ana, patch: { name: "Ana Paula" } });
    expect(() => methods["users.update"](db, { ...ctx, userId: ana }, { id: ana, patch: { role: "admin" } })).toThrow(/administradores/);
    expect(() => methods["teams.create"](db, { ...ctx, userId: ana }, { name: "Time" })).toThrow(/administradores/);
    expect(methods["teams.create"](db, { ...ctx, userId: admin }, { name: "Time" })).toBeTruthy();
  });
});
