// @vitest-environment jsdom
// Nota por áudio: grava, a IA transcreve e ajusta; o texto entra na nota para revisar.
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanPolished, dictateNote, polishPrompt } from "../src/lib/noteDictation";

const ai = vi.hoisted(() => ({
  settings: { provider: "gemini", keys: { gemini: "k" }, models: {} } as Record<string, unknown>,
  transcribe: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("../src/lib/ai", async (orig) => ({
  ...((await orig()) as object),
  loadAiSettings: async () => ai.settings,
  transcribeAudio: ai.transcribe,
  aiGenerate: ai.generate,
}));
vi.mock("../src/rpc/client", () => ({ call: vi.fn(async () => []), DATA_CHANGED_EVENT: "x" }));

afterEach(() => {
  cleanup();
  ai.transcribe.mockReset();
  ai.generate.mockReset();
});

const RAW = "é então assim falei com a Rozi né ela pediu a proposta até sexta tipo o valor de 495 reais";

describe("ditado de nota", () => {
  it("pede para manter os fatos e não inventar; limpa a resposta", () => {
    const p = polishPrompt(RAW);
    expect(p).toContain(RAW);
    expect(p).toMatch(/não invente/);
    expect(p).toMatch(/nomes, valores, datas/);
    expect(cleanPolished('```\n**Nota:** "Falei com a Rozi."\n```')).toBe('Nota: "Falei com a Rozi."');
    expect(cleanPolished('"Falei com a Rozi."')).toBe("Falei com a Rozi.");
  });

  it("transcreve e ajusta; se o ajuste falhar, fica a transcrição", async () => {
    const audio = new Blob(["x".repeat(2000)], { type: "audio/webm;codecs=opus" });
    const transcribe = vi.fn(async () => RAW);
    const ok = await dictateNote(ai.settings as never, audio, { transcribe, generate: vi.fn(async () => "Falei com a Rozi: proposta até sexta, R$ 495,00.") });
    expect(ok).toEqual({ text: "Falei com a Rozi: proposta até sexta, R$ 495,00.", raw: RAW, polished: true });
    expect(transcribe.mock.calls[0]![2]).toBe("audio/webm");
    const fail = await dictateNote(ai.settings as never, audio, { transcribe, generate: vi.fn(async () => Promise.reject(new Error("429"))) });
    expect(fail).toEqual({ text: RAW, raw: RAW, polished: false });
    await expect(dictateNote(ai.settings as never, audio, { transcribe: vi.fn(async () => "  ") })).rejects.toThrow(/Não deu para entender/);
  });
});

describe("botão Gravar áudio na nota", () => {
  it("grava, para, e o texto ajustado entra na nota; o áudio pode ir para os Documentos", async () => {
    ai.transcribe.mockResolvedValue(RAW);
    ai.generate.mockResolvedValue("Falei com a Rozi: ela pediu a proposta até sexta (R$ 495,00).");
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } });
    class FakeRecorder {
      mimeType = "audio/webm;codecs=opus";
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["a".repeat(5000)]) });
        this.onstop?.();
      }
    }
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;

    const { NoteEditor } = await import("../src/dashboard/ui/NotesPanel");
    render(<NoteEditor entityType="deal" entityId="d1" saveLabel="Salvar nota" allowFiles initial="Ligação de hoje." onSave={async () => {}} />);
    const btn = await waitFor(() => {
      const b = document.querySelector("[data-note-audio]") as HTMLButtonElement;
      expect(b.disabled).toBe(false);
      return b;
    });
    await act(async () => fireEvent.click(btn));
    const stop = await waitFor(() => document.querySelector("[data-note-audio-stop]") as HTMLButtonElement);
    expect(stop.textContent).toContain("Gravando 0:00");
    await act(async () => fireEvent.click(stop));
    await waitFor(() => expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Ligação de hoje.\n\nFalei com a Rozi: ela pediu a proposta até sexta (R$ 495,00)."));
    expect(stopTrack).toHaveBeenCalled();
    expect(document.querySelector("[data-note-dictated]")!.textContent).toContain("ajustado pela IA");
    fireEvent.click(document.querySelector("[data-note-keep-audio]")!);
    expect(document.querySelector("[data-note-attachments]")!.textContent).toMatch(/Áudio da nota .*\.webm/);
  });

  it("sem IA que transcreva: avisa o que configurar", async () => {
    ai.settings = { provider: "anthropic", keys: { anthropic: "k" }, models: {} };
    const { NoteEditor } = await import("../src/dashboard/ui/NotesPanel");
    render(<NoteEditor entityType="deal" entityId="d1" saveLabel="Salvar nota" onSave={async () => {}} />);
    const btn = await waitFor(() => {
      const b = document.querySelector("[data-note-audio]") as HTMLButtonElement;
      expect(b.disabled).toBe(false);
      return b;
    });
    expect(btn.title).toMatch(/não transcreve áudio/);
    await act(async () => fireEvent.click(btn));
    expect(document.body.textContent).toMatch(/use Gemini ou OpenAI/);
  });
});
