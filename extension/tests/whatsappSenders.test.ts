import { describe, expect, it } from "vitest";
import { channelReady, withDefaults } from "../src/lib/notify/settings";
import { sameNumber, zapiSendFile, zapiSendText, zapiStatus } from "../src/lib/whatsappSenders";

const creds = { instanceId: "INST1", token: "TOK1", clientToken: "CT1" };
function fakeFetch(reply: unknown, status = 200) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("números de origem do WhatsApp", () => {
  it("mesmo número com ou sem o 9 e com ou sem +55", () => {
    expect(sameNumber("(81) 98729-8285", "+5581987298285")).toBe(true);
    expect(sameNumber("+55 81 8729-8285", "81987298285")).toBe(true);
    expect(sameNumber("81987298285", "41987298285")).toBe(false);
    expect(sameNumber("81987298285", "81987298286")).toBe(false);
  });

  it("Z-API: texto, imagem, documento e status", async () => {
    const t = fakeFetch({ zaapId: "1", messageId: "2" });
    await zapiSendText(creds, "(81) 98729-8285", "Olá", t.fn);
    expect(t.calls[0]).toMatchObject({
      url: "https://api.z-api.io/instances/INST1/token/TOK1/send-text",
      method: "POST",
      headers: { "Client-Token": "CT1" },
      body: { phone: "5581987298285", message: "Olá" },
    });
    await zapiSendFile(creds, "81987298285", { dataUrl: "data:image/png;base64,AAA", filename: "print.png", mime: "image/png" }, "Veja", t.fn);
    expect(t.calls[1]).toMatchObject({ url: expect.stringMatching(/\/send-image$/), body: { image: "data:image/png;base64,AAA", caption: "Veja" } });
    await zapiSendFile(creds, "81987298285", { dataUrl: "data:application/pdf;base64,BBB", filename: "CONTRATO.pdf", mime: "application/pdf" }, "", t.fn);
    expect(t.calls[2]).toMatchObject({
      url: expect.stringMatching(/\/send-document\/pdf$/),
      body: { document: "data:application/pdf;base64,BBB", fileName: "CONTRATO" },
    });
    const st = fakeFetch({ connected: true });
    expect(await zapiStatus(creds, st.fn)).toMatchObject({ connected: true });
    expect(st.calls[0]!.method).toBe("GET");
    await expect(zapiSendText(creds, "81987298285", "x", fakeFetch({ error: "Instance not found" }, 404).fn)).rejects.toThrow(/Z-API: Instance not found/);
    await expect(zapiSendText(creds, "81987298285", "x", fakeFetch({ error: "invalid token" }, 401).fn)).rejects.toThrow(/inválido/);
  });

  it("lembretes por um número da Z-API", () => {
    const base = { enabled: true, phone: "41999998888", apikey: "" };
    expect(channelReady(withDefaults({ whatsapp: { ...base, via: "zapi", senderId: "s1" } }), "whatsapp")).toBe(true);
    expect(channelReady(withDefaults({ whatsapp: { ...base, via: "zapi" } }), "whatsapp")).toBe(false);
  });
});
