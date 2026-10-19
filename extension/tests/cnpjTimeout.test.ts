import { describe, expect, it } from "vitest";
import { cnpjToOrganizationFields, lookupCnpj } from "../src/lib/cnpj";

describe("consulta de CNPJ", () => {
  it("fonte que trava não segura as outras; erro diz o que houve com cada uma", async () => {
    const hang = ((url: string, init: RequestInit) =>
      url.includes("brasilapi")
        ? Promise.resolve(new Response(JSON.stringify({ cnpj: "19489640000135", razao_social: "ESCOLA ESTADUAL AMILCAR SAVASSI", uf: "MG" }), { status: 200 }))
        : new Promise((_, reject) =>
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
          )) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await lookupCnpj("19.489.640/0001-35", hang, 300);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ ok: true, sources: ["BrasilAPI"], data: { razaoSocial: "ESCOLA ESTADUAL AMILCAR SAVASSI" } });
    const none = ((url: string, init: RequestInit) =>
      url.includes("receitaws")
        ? Promise.resolve(new Response(JSON.stringify({ status: "ERROR", message: "Too many requests" }), { status: 429 }))
        : new Promise((_, reject) =>
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
          )) as unknown as typeof fetch;
    const bad = await lookupCnpj("19489640000135", none, 300);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/BrasilAPI: sem resposta.*ReceitaWS: limite de consultas/);
  });
});

describe("CNPJ sem e-mail/telefone (ex.: escola pública)", () => {
  it("monta os campos do cadastro sem quebrar", async () => {
    const body = { cnpj: "19489640000135", razao_social: "CAIXA ESCOLAR AMILCAR SAVASSI", nome_fantasia: "", email: null, ddd_telefone_1: "", cnae_fiscal: 8513900, cnae_fiscal_descricao: null, cep: "35700000", municipio: "SETE LAGOAS", uf: "MG", numero: 100 };
    const fetchFn = (async (url: string) =>
      url.includes("brasilapi") ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const r = await lookupCnpj("19489640000135", fetchFn, 1000, 50);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = cnpjToOrganizationFields(r.data);
    expect(f.legalName).toBe("CAIXA ESCOLAR AMILCAR SAVASSI");
    expect(f.name).toBe("CAIXA ESCOLAR AMILCAR SAVASSI");
    expect(f.email).toBe("");
    expect(f.segment).toBe("");
    expect(f.number).toBe("100");
    expect(f.city).toBe("SETE LAGOAS");
  });
});
