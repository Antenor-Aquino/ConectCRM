// Ficha do cartão (visão completa) por funil: ordem/visibilidade dos campos.
import { describe, expect, it } from "vitest";
import { createPipeline, listPipelines, updatePipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { blocksFor, defaultDetailLayout, isDefaultLayout, parseDetailLayout, resolveDetailLayout } from "../src/lib/detailLayout";
import { freshDb } from "./helpers";

describe("ficha do cartão: layout", () => {
  it("padrão por tipo de funil: blocos do tipo e campos personalizados no fim", () => {
    expect(defaultDetailLayout("comercial", ["a", "b"]).map((i) => i.key)).toEqual([
      "valor",
      "secao:relacionamento",
      "contato",
      "outros_contatos",
      "organizacao",
      "outras_organizacoes",
      "secao:detalhes",
      "responsavel",
      "tags",
      "cf:a",
      "cf:b",
    ]);
    expect(blocksFor("projeto").map((b) => b.key)).toContain("datas");
    expect(blocksFor("operacional").map((b) => b.key)).toEqual(expect.arrayContaining(["descricao", "sla"]));
    expect(blocksFor("comercial").map((b) => b.key)).not.toContain("sla");
  });

  it("salvo + o que existe hoje: tira o removido, mantém escondidos, põe o novo no fim", () => {
    const saved = parseDetailLayout(
      JSON.stringify([{ key: "cf:a" }, { key: "organizacao" }, { key: "contato", hidden: true }, { key: "cf:apagado" }, { key: "sla" }, { key: "xss<script>" }, { key: "cf:a" }]),
    );
    const r = resolveDetailLayout(saved, "comercial", ["a", "novo"]);
    expect(r.slice(0, 3)).toEqual([{ key: "cf:a" }, { key: "organizacao" }, { key: "contato", hidden: true }]);
    expect(r.map((i) => i.key)).not.toContain("cf:apagado");
    expect(r.map((i) => i.key)).not.toContain("sla");
    expect(r.at(-1)).toEqual({ key: "cf:novo" });
    expect(r.filter((i) => i.key === "valor")).toHaveLength(1);
    expect(parseDetailLayout("não é json")).toBeNull();
    expect(isDefaultLayout(defaultDetailLayout("comercial", ["a"]), "comercial", ["a"])).toBe(true);
    expect(isDefaultLayout(r, "comercial", ["a", "novo"])).toBe(false);
  });

  it("grava no funil (por funil) e recusa chave inválida", async () => {
    const { db, ctx: sys } = await freshDb();
    const me = createUser(db, sys, { name: "Antenor", role: "admin" });
    const ctx = { ...sys, userId: me };
    const pc = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "P" }] });
    const ce = createPipeline(db, ctx, { name: "Certificados", type: "comercial", stages: [{ name: "P" }] });
    updatePipeline(db, ctx, pc, { detailLayout: [{ key: "organizacao" }, { key: "contato", hidden: true }] });
    const get = (id: string) => listPipelines(db).find((p) => p.id === id)!;
    expect(parseDetailLayout(get(pc).detail_layout)).toEqual([{ key: "organizacao" }, { key: "contato", hidden: true }]);
    expect(get(ce).detail_layout).toBeNull();
    expect(() => updatePipeline(db, ctx, pc, { detailLayout: [{ key: "hacker" }] })).toThrow(/inválido/);
    updatePipeline(db, ctx, pc, { detailLayout: null });
    expect(get(pc).detail_layout).toBeNull();
  });
});
