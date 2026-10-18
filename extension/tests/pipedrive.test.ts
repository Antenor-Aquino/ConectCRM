import { describe, expect, it } from "vitest";
import type { CustomField } from "../src/db/customFields";
import { PipedriveClient, type PdField } from "../src/lib/pipedrive/api";
import { buildRow, crmTargets, guessFieldMapping, OWNER_NONE, sourceFields, summarize } from "../src/lib/pipedrive/records";
import { pipedriveBaseUrl, pipedriveRecordUrl } from "../src/lib/integrations";

const HASH_ORIGEM = "a".repeat(40);
const HASH_CARGO = "b".repeat(40);
const HASH_CNPJ = "c".repeat(40);
const HASH_SEGMENTO = "d".repeat(40);

/** fetch simulado: rota (caminho sem query) → resposta; guarda as chamadas. */
function fakeFetch(routes: Record<string, (url: URL) => { status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: { url: URL; token: string | null }[] = [];
  const fn = async (u: string, init?: RequestInit) => {
    const url = new URL(u);
    calls.push({ url, token: new Headers(init?.headers).get("x-api-token") });
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ success: false, error: "not found" }), { status: 404 });
    const r = route(url);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  };
  return { fn, calls };
}

const person = (id: number, add: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Pessoa ${id}`,
  owner_id: 11,
  org_id: 10,
  emails: [{ value: `p${id}@x.com`, primary: true }],
  phones: [{ value: "(41) 99999-8888", primary: true }],
  label_ids: [5],
  add_time: add,
  update_time: add,
  custom_fields: { [HASH_ORIGEM]: 3, [HASH_CARGO]: "Diretora" },
  ...extra,
});

describe("cliente da API do Pipedrive", () => {
  it("manda a chave no cabeçalho, espera no limite de uso (429) e traduz chave inválida", async () => {
    let n = 0;
    const f = fakeFetch({
      "/v1/users/me": () =>
        ++n === 1
          ? { status: 429, body: {}, headers: { "retry-after": "2" } }
          : { body: { success: true, data: { name: "Antenor", company_domain: "stepple" } } },
    });
    const waits: number[] = [];
    const c = new PipedriveClient("tok123", f.fn, async (ms) => void waits.push(ms));
    expect((await c.me()).company_domain).toBe("stepple");
    expect(waits).toEqual([2000]);
    expect(f.calls.every((x) => x.token === "tok123")).toBe(true);
    const bad = new PipedriveClient("x", fakeFetch({ "/v1/users/me": () => ({ status: 401, body: { success: false } }) }).fn);
    await expect(bad.me()).rejects.toThrow(/Chave da API do Pipedrive inválida/);
  });

  it("criados no período: do mais novo ao mais antigo, com cursor, parando antes do início", async () => {
    const pages: Record<string, unknown[]> = {
      "": [person(5, "2026-03-20T10:00:00Z"), person(4, "2026-03-15T10:00:00Z")],
      c2: [person(3, "2026-03-05T10:00:00Z"), person(2, "2026-02-27T10:00:00Z")],
      c3: [person(1, "2026-01-01T10:00:00Z")],
    };
    const f = fakeFetch({
      "/api/v2/persons": (url) => {
        const cur = url.searchParams.get("cursor") ?? "";
        return { body: { success: true, data: pages[cur], additional_data: { next_cursor: cur === "" ? "c2" : cur === "c2" ? "c3" : null } } };
      },
    });
    const c = new PipedriveClient("t", f.fn);
    const r = await c.listCreated("person", "2026-03-01", "2026-03-16");
    expect(r.items.map((x) => x.id)).toEqual([4, 3]);
    expect(f.calls.map((x) => x.url.searchParams.get("cursor"))).toEqual([null, "c2"]); // não pediu c3
    expect(f.calls[0]!.url.searchParams.get("sort_by")).toBe("add_time");
    expect(f.calls[0]!.url.searchParams.get("sort_direction")).toBe("desc");
  });

  it("leads pela v1 (start/limit, sort) e busca pelo nome trazendo os registros completos", async () => {
    const leads = [
      { id: "u2", title: "Lead B", add_time: "2026-03-02T10:00:00.000Z" },
      { id: "u1", title: "Lead A", add_time: "2026-02-01T10:00:00.000Z" },
    ];
    const f = fakeFetch({
      "/v1/leads": () => ({ body: { success: true, data: leads } }),
      "/api/v2/organizations/search": () => ({ body: { success: true, data: { items: [{ item: { id: 10 } }, { item: { id: 12 } }] } } }),
      "/api/v2/organizations": (url) => ({
        body: { success: true, data: (url.searchParams.get("ids") ?? "").split(",").map((id) => ({ id: Number(id), name: `Org ${id}` })) },
      }),
    });
    const c = new PipedriveClient("t", f.fn);
    expect((await c.listCreated("lead", "2026-03-01", "")).items.map((x) => x.id)).toEqual(["u2"]);
    expect(f.calls[0]!.url.searchParams.get("sort")).toBe("add_time DESC");
    const orgs = await c.search("organization", "Org");
    expect(orgs.map((o) => o.name)).toEqual(["Org 10", "Org 12"]);
    expect(f.calls.at(-1)!.url.searchParams.get("ids")).toBe("10,12");
  });
});

describe("registros do Pipedrive → linhas de importação", () => {
  const personFields: PdField[] = [
    { key: "name", name: "Nome", field_type: "varchar" },
    { key: "label_ids", name: "Etiqueta", field_type: "set", options: [{ id: 5, label: "Cliente" }] },
    { key: HASH_ORIGEM, name: "Origem do contato", field_type: "enum", options: [{ id: 3, label: "Feira" }] },
    { key: HASH_CARGO, name: "Cargo", field_type: "varchar" },
  ];
  const users = [{ id: 11, name: "Antenor", email: "antenor@x.com" }];
  const origemCrm = {
    id: "cf-origem",
    name: "Origem do contato",
    field_type: "select",
    options: [{ id: "opt-feira", label: "Feira", color: null }],
  } as unknown as CustomField;
  const cargoCrm = { id: "cf-cargo", name: "Cargo", field_type: "text", options: [] } as unknown as CustomField;

  it("campos legíveis, sugestão do de-para e linha com responsável, tags e opções", () => {
    const sources = sourceFields("person", { fields: personFields, users });
    const raw = person(7, "2026-03-10T12:00:00Z");
    const byKey = Object.fromEntries(sources.map((s) => [s.key, s.get(raw)]));
    expect(byKey).toMatchObject({
      name: ["Pessoa 7"],
      email: ["p7@x.com"],
      owner: ["Antenor"],
      labels: ["Cliente"],
      [HASH_ORIGEM]: ["Feira"],
      [HASH_CARGO]: ["Diretora"],
    });
    const targets = crmTargets("person", [origemCrm, cargoCrm]);
    const fields = guessFieldMapping("person", sources, targets);
    expect(fields).toEqual({
      name: "name",
      email: "email",
      phone: "phone",
      owner: "owner",
      labels: "tags",
      [HASH_ORIGEM]: "cf:cf-origem",
      [HASH_CARGO]: "cf:cf-cargo",
    });
    const row = buildRow("person", raw, sources, targets, { fields, owners: { "11": OWNER_NONE }, options: { "cf:cf-origem": { feira: "opt-feira" } } });
    expect(row).toEqual({
      externalId: "7",
      label: "Pessoa 7",
      sourceUpdatedAt: "2026-03-10T12:00:00Z",
      name: "Pessoa 7",
      email: "p7@x.com",
      phone: "(41) 99999-8888",
      ownerId: null,
      tags: ["Cliente"],
      custom: { "cf-origem": "opt-feira", "cf-cargo": "Diretora" },
      organizationExternalId: "10",
    });
  });

  it("organização: endereço por partes e CNPJ/segmento personalizados para os campos do CRM", () => {
    const fields: PdField[] = [
      { key: HASH_CNPJ, name: "CNPJ", field_type: "varchar" },
      { key: HASH_SEGMENTO, name: "Ramo de atividade", field_type: "varchar" },
    ];
    const sources = sourceFields("organization", { fields, users });
    const targets = crmTargets("organization", []);
    const map = guessFieldMapping("organization", sources, targets);
    expect(map).toMatchObject({ [HASH_CNPJ]: "cnpj", [HASH_SEGMENTO]: "segment", address_locality: "city", address_postal_code: "cep" });
    const raw = {
      id: 10,
      name: "Colégio Alfa",
      address: { value: "Rua X, 10", route: "Rua X", street_number: "10", locality: "Curitiba", admin_area_level_1: "PR", postal_code: "80000-000" },
      custom_fields: { [HASH_CNPJ]: "11.222.333/0001-81" },
      add_time: "2026-01-01T00:00:00Z",
    };
    const row = buildRow("organization", raw, sources, targets, { fields: map, owners: {}, options: {} });
    expect(row).toMatchObject({
      name: "Colégio Alfa",
      street: "Rua X",
      number: "10",
      city: "Curitiba",
      state: "PR",
      cep: "80000-000",
      cnpj: "11.222.333/0001-81",
    });
    expect(summarize("organization", raw, sources)).toMatchObject({ cnpj: "11.222.333/0001-81", detail: "Curitiba - PR" });
  });

  it("lead (v1): valor, etiquetas de lead, contato/organização e campo personalizado na raiz", () => {
    const hash = "e".repeat(40);
    const sources = sourceFields("lead", {
      fields: [
        {
          key: hash,
          name: "Segmento",
          field_type: "set",
          options: [
            { id: 1, label: "Escola" },
            { id: 2, label: "Faculdade" },
          ],
        },
      ],
      users,
      leadLabels: [{ id: "lbl-1", name: "Quente" }],
    });
    const raw = {
      id: "uuid-1",
      title: "Lead Alfa",
      owner_id: 11,
      person_id: 7,
      organization_id: 10,
      value: { amount: 1500.5, currency: "BRL" },
      expected_close_date: "2026-12-15",
      label_ids: ["lbl-1"],
      source_name: "Site",
      [hash]: "1,2",
      add_time: "2026-03-10T12:00:00.000Z",
      update_time: "2026-03-11T12:00:00.000Z",
    };
    const targets = crmTargets("deal", []);
    const row = buildRow("lead", raw, sources, targets, {
      fields: { ...guessFieldMapping("lead", sources, targets), [hash]: "description" },
      owners: {},
      options: {},
    });
    expect(row).toMatchObject({
      title: "Lead Alfa",
      value: "1500.5",
      expectedCloseAt: "2026-12-15",
      origin: "Site",
      tags: ["Quente"],
      description: "Escola; Faculdade",
      personExternalId: "7",
      organizationExternalId: "10",
    });
    expect(row.ownerId).toBeUndefined(); // sem de-para do usuário: quem importa
    expect(summarize("lead", raw).detail).toBe("BRL 1.500,50");
  });

  it("links do registro original", () => {
    expect(pipedriveBaseUrl("https://stepple.pipedrive.com/pipeline")).toBe("https://stepple.pipedrive.com");
    expect(pipedriveRecordUrl("stepple", "person", "7")).toBe("https://stepple.pipedrive.com/person/7");
    expect(pipedriveRecordUrl("stepple.pipedrive.com", "deal", "uuid")).toBe("https://stepple.pipedrive.com/leads/inbox/uuid");
  });
});
