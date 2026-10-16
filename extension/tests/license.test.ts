import { describe, expect, it } from "vitest";
import { formatKeyInput, inGracePeriod, LicenseClient, normalizeKey, planLabel, PRODUCT, type LicenseDeps } from "../src/lib/license";

function fakeDeps(responses: Record<string, unknown | Error>) {
  const store = new Map<string, unknown>();
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let now = 1_000_000;
  const deps: LicenseDeps = {
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https:\/\/[^/]+/, "");
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : {} });
      const r = responses[path];
      if (r instanceof Error) throw r;
      return { json: async () => r } as Response;
    }) as typeof fetch,
    storage: { get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) },
    now: () => now,
  };
  return { deps, calls, advance: (ms: number) => (now += ms) };
}

describe("licença por instalação", () => {
  it("normaliza e formata a chave", () => {
    expect(normalizeKey("abcd1234ef56")).toBe("CLAUDIACRM-ABCD-1234-EF56");
    expect(normalizeKey("claudiacrm-ABCD-1234-EF56")).toBe("CLAUDIACRM-ABCD-1234-EF56");
    expect(formatKeyInput("abcd1234e")).toBe("ABCD-1234-E");
    expect(planLabel({ plano: "anual", expira_em: "2027-01-31T12:00:00Z" })).toBe("Anual — expira em 31/01/2027");
  });

  it("sem chave salva: inválida sem chamar o servidor", async () => {
    const { deps, calls } = fakeDeps({});
    expect(await new LicenseClient(deps).check()).toEqual({ valida: false, motivo: "sem_chave" });
    expect(calls).toHaveLength(0);
  });

  it("ativa a chave neste computador e envia device e produto", async () => {
    const { deps, calls } = fakeDeps({ "/ativar": { valida: true, dados: { plano: "mensal" } }, "/validar": { valida: true, dados: { plano: "mensal" } } });
    const lic = new LicenseClient(deps);
    expect((await lic.activate("abcd-1234-ef56")).valida).toBe(true);
    expect(calls[0]!.body).toMatchObject({ chave: "CLAUDIACRM-ABCD-1234-EF56", produto: PRODUCT });
    expect(String(calls[0]!.body.device_id)).toMatch(/^dev-/);
    expect((await lic.check()).valida).toBe(true);
    expect(calls[1]!.body.device_id).toBe(calls[0]!.body.device_id);
  });

  it("servidor fora do ar: aceita o último resultado por até 24 h", async () => {
    const responses: Record<string, unknown> = { "/ativar": { valida: true, dados: { plano: "anual" } } };
    const { deps, advance } = fakeDeps(responses);
    const lic = new LicenseClient(deps);
    await lic.activate("abcd1234ef56");
    responses["/validar"] = new Error("offline");
    expect(await lic.check()).toMatchObject({ valida: true, motivo: "offline_cache" });
    advance(25 * 3600_000);
    expect(await lic.check()).toEqual({ valida: false, motivo: "offline_sem_cache" });
  });

  it("chave recusada continua salva para nova tentativa", async () => {
    const { deps } = fakeDeps({ "/ativar": { valida: false, motivo: "expirada" } });
    const lic = new LicenseClient(deps);
    expect(await lic.activate("abcd1234ef56")).toEqual({ valida: false, motivo: "expirada" });
    expect(await lic.savedKey()).toBe("CLAUDIACRM-ABCD-1234-EF56");
  });

  it("código do WhatsApp ativa a chave devolvida", async () => {
    const { deps, calls } = fakeDeps({ "/validar-otp": { ok: true, chave: "CLAUDIACRM-AAAA-BBBB-CCCC" }, "/ativar": { valida: true, dados: { plano: "trial" } } });
    const r = await new LicenseClient(deps).validateCode("a@b.com", "1234-5678");
    expect(r.ok).toBe(true);
    expect(calls[0]!.body).toMatchObject({ email: "a@b.com", codigo: "12345678" });
    expect(calls[1]!.body.chave).toBe("CLAUDIACRM-AAAA-BBBB-CCCC");
  });

  it("carência: válida, mas com aviso de pagamento pendente", () => {
    expect(inGracePeriod({ valida: true, dados: { em_carencia: true } })).toBe(true);
    expect(inGracePeriod({ valida: true })).toBe(false);
  });
});
