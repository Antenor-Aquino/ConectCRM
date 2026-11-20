// Organização pelo CNPJ digitado na busca do cartão: usa a existente ou cria
// com os dados da Receita.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { method: string; params: Record<string, unknown> }[]);
const existing = vi.hoisted(() => ({ value: null as null | { id: string; name: string } }));
vi.mock("../src/rpc/client", () => ({
  call: vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === "organizations.findByCnpj") return existing.value;
    if (method === "organizations.create") return "org-new";
    return [];
  }),
}));
import { createOrganizationFromCnpj, looksLikeCnpj, organizationCreateLabel } from "../src/dashboard/cards/searchers";
import { emptyCnpjData } from "../src/lib/cnpj";

beforeEach(() => {
  calls.length = 0;
  existing.value = null;
});

const receita = () => {
  const d = emptyCnpjData();
  d.razaoSocial = "CAIXA ESCOLAR DOUTOR JOAO PINHEIRO";
  d.nomeFantasia = "";
  d.endereco = { ...d.endereco, cep: "36730000", logradouro: "AV PRESIDENTE CARLOS LUZ", numero: "141", bairro: "CENTRO", municipio: "PIRAPETINGA", uf: "MG" };
  return d;
};

describe("organização pelo CNPJ", () => {
  it("reconhece CNPJ digitado (com ou sem máscara) e muda o botão", () => {
    expect(looksLikeCnpj("19.929.587/0001-46")).toBe(true);
    expect(looksLikeCnpj("19929587000146")).toBe(true);
    expect(looksLikeCnpj("1992958700014")).toBe(false);
    expect(looksLikeCnpj("Caixa Escolar 19929587000146")).toBe(false);
    expect(organizationCreateLabel("19929587000146")).toBe("Criar pela Receita (CNPJ)");
    expect(organizationCreateLabel("Caixa Escolar")).toBe("Criar organização");
  });

  it("cria com os dados da Receita (nome = razão social sem nome fantasia)", async () => {
    const lookup = vi.fn(async () => ({ ok: true as const, data: receita(), sources: ["BrasilAPI"] }));
    const item = await createOrganizationFromCnpj("19.929.587/0001-46", lookup);
    expect(item).toMatchObject({ id: "org-new", label: "CAIXA ESCOLAR DOUTOR JOAO PINHEIRO", sublabel: "PIRAPETINGA/MG" });
    expect(calls.find((c) => c.method === "organizations.create")!.params).toMatchObject({
      name: "CAIXA ESCOLAR DOUTOR JOAO PINHEIRO",
      cnpj: "19929587000146",
      legalName: "CAIXA ESCOLAR DOUTOR JOAO PINHEIRO",
      cep: "36730000",
      street: "AV PRESIDENTE CARLOS LUZ",
      city: "PIRAPETINGA",
      state: "MG",
    });
  });

  it("CNPJ já cadastrado: usa o existente; inválido: avisa; Receita fora: cria só com o CNPJ", async () => {
    existing.value = { id: "org-1", name: "Caixa Escolar" };
    expect(await createOrganizationFromCnpj("19929587000146", vi.fn())).toEqual({ id: "org-1", label: "Caixa Escolar" });
    expect(calls.some((c) => c.method === "organizations.create")).toBe(false);
    await expect(createOrganizationFromCnpj("19929587000147", vi.fn())).rejects.toThrow(/CNPJ inválido/);
    existing.value = null;
    const item = await createOrganizationFromCnpj("19929587000146", vi.fn(async () => ({ ok: false as const, error: "fora do ar" })));
    expect(item.label).toBe("CNPJ 19.929.587/0001-46");
    expect(calls.at(-1)!.params).toEqual({ name: "CNPJ 19.929.587/0001-46", cnpj: "19929587000146" });
  });
});
