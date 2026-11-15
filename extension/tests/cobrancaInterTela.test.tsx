// @vitest-environment jsdom
// Tela "Cobrança": escolher Banco Inter mostra o pagador (vindo do cartão),
// avisa o que falta e emite o boleto pelo Fiscal (simulado).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { method: string; params: Record<string, unknown> }[] = [];
const draft = {
  cardTitle: "Certificado digital A1",
  items: [{ description: "Certificado A3 - 24 meses", quantity: 1, priceCents: 5200 }],
  totalCents: 5200,
  customer: { name: "Cristiane", email: null, phone: null },
  payer: {
    kind: "JURIDICA",
    document: "68153622000193",
    name: "Caixa Escolar Prof. Hildebrando Pontes",
    email: "",
    phone: "",
    cep: "38400000",
    street: "Rua das Flores",
    number: "100",
    complement: "",
    district: "Centro",
    city: "Uberlândia",
    state: "MG",
  },
  charges: [],
};
vi.mock("../src/rpc/client", () => ({
  call: vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === "charges.draft") return draft;
    if (method === "charges.saveInter") return "charge-1";
    return undefined;
  }),
  DATA_CHANGED_EVENT: "data-changed",
}));
vi.mock("../src/lib/documentFiles", () => ({
  prepareFile: vi.fn(async (f: File) => ({ file: f, sha256: "a".repeat(64), text: null })),
  saveContent: vi.fn(async () => ({ sha256: "a".repeat(64), mime: "application/pdf", size: 3, filename: "b.pdf", location: "browser" })),
  saveBlobAs: vi.fn(),
}));
const fiscalMsgs: Record<string, unknown>[] = [];
vi.mock("../src/lib/nfse/fiscal", () => ({
  fiscalVersion: async () => "1.1.0",
  fiscalCall: vi.fn(async (msg: Record<string, unknown>) => {
    fiscalMsgs.push(msg);
    if (msg.cmd === "interStatus") return { ok: true, inter: { configured: true } };
    const ok = (body: unknown) => ({ ok: true, http: { httpStatus: 200, body: JSON.stringify(body) } });
    if (msg.path === "/cobranca/v3/cobrancas") return ok({ codigoSolicitacao: "abc" });
    if (msg.path === "/cobranca/v3/cobrancas/abc")
      return ok({ cobranca: { codigoSolicitacao: "abc", situacao: "A_RECEBER" }, boleto: { linhaDigitavel: "07790001" }, pix: { pixCopiaECola: "000201PIX" } });
    if (msg.path === "/cobranca/v3/cobrancas/abc/pdf") return ok({ pdf: btoa("%PDF-1.4") });
    return { ok: true, http: { httpStatus: 404, body: "{}" } };
  }),
}));

const store: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: { get: async (k: string) => ({ [k]: store[k] }), set: async (o: Record<string, unknown>) => Object.assign(store, o) } },
  runtime: {},
};
vi.useFakeTimers({ shouldAdvanceTime: true });

afterEach(() => cleanup());

describe("Cobrança pelo Banco Inter (tela)", () => {
  it("emite o boleto com o pagador do cartão e lança a receita", async () => {
    const { ChargeDialog } = await import("../src/dashboard/cards/ChargeDialog");
    const onLaunch = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ChargeDialog cardId="card-1" gfActive onClose={() => {}} onLaunchFinance={onLaunch} />);
    await screen.findByText("Certificado digital A1", { exact: false }).catch(() => null);
    await waitFor(() => expect(document.querySelector("[data-charge-provider-option=inter]")).not.toBeNull());
    fireEvent.click(document.querySelector("[data-charge-provider-option=inter]")!);
    expect((document.querySelector("[data-payer-name]") as HTMLInputElement).value).toBe("Caixa Escolar Prof. Hildebrando Pontes");
    // Tira a cidade: aparece o aviso e o botão desliga.
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "" } });
    expect(document.querySelector("[data-charge-problems]")!.textContent).toContain("Cidade do pagador.");
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Uberlândia" } });
    const due = document.querySelector("[data-charge-due]") as HTMLInputElement;
    fireEvent.change(due, { target: { value: "2099-12-01" } });
    const btn = document.querySelector("[data-charge-generate]") as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(btn.textContent).toContain("Emitir boleto + Pix");
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(document.querySelector("[data-charge-created-inter]")).not.toBeNull());
    expect(document.querySelector("[data-charge-created-inter]")!.textContent).toContain("07790001");
    const save = calls.find((c) => c.method === "charges.saveInter")!.params;
    expect(save).toMatchObject({ env: "sandbox", codigoSolicitacao: "abc", barcode: "07790001", pixCode: "000201PIX", dueDate: "2099-12-01" });
    expect(calls.some((c) => c.method === "charges.savePdf")).toBe(true);
    const post = fiscalMsgs.find((m) => m.path === "/cobranca/v3/cobrancas")!;
    expect(JSON.parse(String(post.body))).toMatchObject({ valorNominal: 52, pagador: { cidade: "Uberlândia", uf: "MG", cpfCnpj: "68153622000193" } });
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 5200, requestId: save.seuNumero, dueDate: "2099-12-01" }));
  });
});
