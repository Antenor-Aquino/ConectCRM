// Envio pelo WhatsApp Web com contas migradas para LID ("No LID for user").
import { afterEach, describe, expect, it, vi } from "vitest";
import { waSend } from "../src/lib/notify/waweb";

const wid = (s: string) => ({ _serialized: s, toString: () => s, user: s.split("@")[0] });

function fakeWpp(opts: { lid?: string; failFor: string[]; active?: string; pnOfLid?: string }) {
  const sent: string[] = [];
  const WPP = {
    isFullReady: true,
    conn: { isAuthenticated: () => true, getMyUserId: () => wid("5581900000000@c.us") },
    contact: {
      queryWidExists: async (id: string) => ({ wid: wid(id), ...(opts.lid ? { lid: wid(opts.lid) } : {}) }),
      getPnLidEntry: async () => ({ phoneNumber: opts.pnOfLid ? { id: opts.pnOfLid } : undefined }),
    },
    chat: {
      getActiveChat: () => (opts.active ? { id: wid(opts.active) } : undefined),
      sendTextMessage: async (to: string) => {
        if (opts.failFor.includes(to)) throw new Error("No LID for user");
        sent.push(to);
      },
    },
  };
  (globalThis as unknown as { window: unknown }).window = { WPP };
  return sent;
}

afterEach(() => vi.useRealTimers());

describe("waSend e o LID", () => {
  it("reenvia pelo LID quando o número falha com No LID", async () => {
    const sent = fakeWpp({ lid: "123@lid", failFor: ["5581999998888@c.us"] });
    expect(await waSend("5581999998888", { text: "oi" }, 1000, null)).toEqual({ ok: true, me: "5581900000000" });
    expect(sent).toEqual(["123@lid"]);
  });

  it("sem LID na consulta: devolve no-lid (o CRM abre a conversa pelo link oficial)", async () => {
    fakeWpp({ failFor: ["5581999998888@c.us"] });
    expect(await waSend("5581999998888", { text: "oi" }, 1000, null)).toMatchObject({ ok: false, code: "no-lid" });
  });

  it("pela conversa aberta: envia ao LID dela se for do mesmo número", async () => {
    const sent = fakeWpp({ failFor: ["5581999998888@c.us"], active: "777@lid", pnOfLid: "5581999998888" });
    expect(await waSend("5581999998888", { text: "oi" }, 1000, null, true)).toMatchObject({ ok: true });
    expect(sent).toEqual(["777@lid"]);
  });

  it("pela conversa aberta: não envia se a conversa for de outro número", async () => {
    vi.useFakeTimers();
    const sent = fakeWpp({ failFor: [], active: "777@lid", pnOfLid: "5511911112222" });
    const p = waSend("5581999998888", { text: "oi" }, 1000, null, true);
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ ok: false, code: "no-lid" });
    expect(sent).toEqual([]);
  });
});
