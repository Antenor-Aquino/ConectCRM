import { describe, expect, it } from "vitest";
import { createPerson, findPersonsByPhone, phoneMatchKey } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("telefone do WhatsApp", () => {
  it("casa com e sem o 9º dígito (mesmo DDD)", () => {
    expect(phoneMatchKey("+5541999998888")).toBe(phoneMatchKey("+554199998888"));
    expect(phoneMatchKey("+5541999998888")).not.toBe(phoneMatchKey("+5511999998888"));
    expect(phoneMatchKey("123")).toBeNull();
  });

  it("acha o contato pelo telefone da conversa", async () => {
    const { db, ctx } = await freshDb();
    createPerson(db, ctx, { name: "Regina", phone: "(41) 99999-8888" });
    createPerson(db, ctx, { name: "Outra", phone: "(11) 99999-8888" });
    expect(findPersonsByPhone(db, "+554199998888").map((p) => p.name)).toEqual(["Regina"]);
    expect(findPersonsByPhone(db, "+5541999998888").map((p) => p.name)).toEqual(["Regina"]);
    expect(findPersonsByPhone(db, "+5521911112222")).toEqual([]);
  });
});

describe("roteador de IA", () => {
  const settings = (provider: import("../src/lib/ai").AiProvider) => ({ provider, keys: { [provider]: "k-123" }, models: {}, prompt1: "", prompt2: "" });
  const mockFetch = (status: number, json: unknown) => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;
    return calls;
  };

  it("monta a chamada de cada provedor com as imagens", async () => {
    const { aiGenerate } = await import("../src/lib/ai");
    let calls = mockFetch(200, { candidates: [{ content: { parts: [{ text: " ok " }] } }] });
    expect(await aiGenerate(settings("gemini"), "Resuma", ["AAA"])).toBe("ok");
    expect(calls[0]!.url).toContain("gemini-2.5-flash:generateContent");
    expect(JSON.parse(String(calls[0]!.init.body)).contents[0].parts[1].inline_data.data).toBe("AAA");

    calls = mockFetch(200, { content: [{ text: "claude ok" }] });
    expect(await aiGenerate(settings("claude"), "Resuma", ["BBB"])).toBe("claude ok");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("k-123");

    calls = mockFetch(200, { choices: [{ message: { content: "ds ok" } }] });
    expect(await aiGenerate(settings("deepseek"), "Resuma")).toBe("ds ok");
    expect(calls[0]!.url).toBe("https://api.deepseek.com/chat/completions");
  });

  it("explica erros em português e exige a chave", async () => {
    const { aiGenerate, transcribeAudio } = await import("../src/lib/ai");
    mockFetch(429, { error: { message: "Resource has been exhausted" } });
    await expect(aiGenerate(settings("gemini"), "x")).rejects.toThrow(/Limite de uso/);
    await expect(aiGenerate({ ...settings("openai"), keys: {} }, "x")).rejects.toThrow(/Configure a chave de API do OpenAI/);
    await expect(transcribeAudio(settings("claude"), "AAA", "audio/ogg", "a.ogg")).rejects.toThrow(/não transcreve áudio/);
  });

  it("prompt dos recortes usa o padrão do wa-pipedrive sem o marcador", async () => {
    const { clipPrompt } = await import("../src/lib/ai");
    const p1 = clipPrompt(settings("gemini"), 1);
    expect(p1).toContain("PARTE 1 — TRANSCRIÇÃO NA ÍNTEGRA");
    expect(p1).toContain("(veja as imagens em anexo)");
    expect(p1).not.toContain("[Cole as mensagens");
    expect(clipPrompt({ ...settings("gemini"), prompt2: "Só transcreva." }, 2)).toBe("Só transcreva.\n\nTranscreva as imagens a seguir.");
  });
});
