// Configurações no backup e mudança de instalação: sem credenciais por
// padrão, importar mantém as credenciais desta instalação, pastas não passam
// de uma instalação para outra; registro da instalação no banco.
import { describe, expect, it } from "vitest";
import { checkInstallation, getInstallation, markInstallation } from "../src/db/installation";
import { buildSettingsFile, parseSettingsFile, settingsLabels, settingsToApply } from "../src/lib/settingsTransfer";
import { freshDb } from "./helpers";

const stored = {
  "conectcrm-ai": { provider: "openai", keys: { openai: "sk-123" }, models: {}, prompt1: "", prompt2: "" },
  "conectcrm-integrations": { pipedrive: { token: "pd-1", domain: "aeb", active: true } },
  "conectcrm-whatsapp-senders": { u1: { senders: [{ id: "s1", name: "Comercial", phone: "+55", via: "zapi", zapi: { instance: "i", token: "t", clientToken: "c" } }] } },
  "conectcrm-notify-settings": { u1: { chrome: true, whatsapp: { enabled: true, via: "callmebot", phone: "+55", apikey: "cmb" } } },
  "conectcrm-sound": { sound: "sino", volume: 0.7 },
  "conectcrm-auto-backup": { enabled: true, frequency: "daily", folderName: "Backups", keepDaily: 30 },
  "conectcrm-license": { key: "CLAUDIACRM-XYZ" },
  "conectcrm-current-user": "u1",
  "conectcrm-ms-token": { access: "x" },
};
const opts = { extensionId: "old", appVersion: "0.2.74" };

describe("configurações no backup", () => {
  it("sem credenciais por padrão; só as chaves conhecidas", () => {
    const f = buildSettingsFile(stored, { ...opts, withSecrets: false });
    expect(Object.keys(f.items)).not.toContain("conectcrm-current-user");
    expect(Object.keys(f.items)).not.toContain("conectcrm-ms-token");
    expect(Object.keys(f.items)).not.toContain("conectcrm-license");
    expect(JSON.stringify(f.items)).not.toMatch(/sk-123|pd-1|"t"|cmb/);
    expect((f.items["conectcrm-sound"] as { volume: number }).volume).toBe(0.7);
    expect(settingsLabels(f)).toContain("Números de WhatsApp");
    const all = buildSettingsFile(stored, { ...opts, withSecrets: true });
    expect(JSON.stringify(all.items)).toMatch(/sk-123/);
    expect(all.items["conectcrm-license"]).toEqual({ key: "CLAUDIACRM-XYZ" });
  });

  it("importar sem credenciais mantém as desta instalação; pastas ficam para escolher", () => {
    const f = parseSettingsFile(JSON.stringify(buildSettingsFile(stored, { ...opts, withSecrets: false })));
    const current = { "conectcrm-ai": { keys: { openai: "sk-NOVA" } }, "conectcrm-whatsapp-senders": { u1: { senders: [{ id: "s1", zapi: { token: "z" } }] } } };
    const out = settingsToApply(f, current, "new") as Record<string, any>;
    expect(out["conectcrm-ai"].keys.openai).toBe("sk-NOVA");
    expect(out["conectcrm-whatsapp-senders"].u1.senders[0].zapi).toEqual({ token: "z" });
    expect(out["conectcrm-auto-backup"]).toMatchObject({ enabled: true, keepDaily: 30, folderName: null });
    // Mesma instalação: a pasta continua valendo.
    expect((settingsToApply(f, {}, "old") as Record<string, any>)["conectcrm-auto-backup"].folderName).toBe("Backups");
    expect(() => parseSettingsFile('{"a":1}')).toThrow(/não é de configurações/);
  });
});

describe("instalação", () => {
  it("registra na primeira vez e detecta a mudança de ID", async () => {
    const { db, ctx } = await freshDb();
    expect(getInstallation(db)).toBeNull();
    expect(checkInstallation(db, ctx, "abc")).toEqual({ moved: false, previousId: null });
    expect(checkInstallation(db, ctx, "abc")).toEqual({ moved: false, previousId: "abc" });
    expect(checkInstallation(db, ctx, "xyz")).toEqual({ moved: true, previousId: "abc" });
    markInstallation(db, ctx, "xyz");
    expect(checkInstallation(db, ctx, "xyz").moved).toBe(false);
  });
});
