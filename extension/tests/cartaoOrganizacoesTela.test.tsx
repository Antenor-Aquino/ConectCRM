// @vitest-environment jsdom
// Campo "Outras organizações" do cartão: papel, principal e desvincular.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { method: string; params: Record<string, unknown> }[]);
vi.mock("../src/rpc/client", () => ({
  call: vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    return [];
  }),
  DATA_CHANGED_EVENT: "x",
}));
import { CardOrganizationsField } from "../src/dashboard/cards/CardOrganizationsField";

afterEach(cleanup);
const org = (id: string, name: string, role: string) => ({ id, name, legal_name: null, cnpj: null, city: "Uberaba", state: "MG", role, is_payer: role === "pagador" ? 1 : 0 }) as never;

describe("Outras organizações (tela)", () => {
  it("vincular usa o tipo do cadastro (padrão); mostra o papel e muda", async () => {
    const run = vi.fn(async (fn: () => Promise<unknown>) => {
      await fn();
      return true;
    });
    render(<CardOrganizationsField cardId="c1" organizations={[org("e", "EE Celina Machado", "principal"), org("m", "Rede Saber", "mantenedora")]} run={run} onOpen={() => {}} />);
    expect((document.querySelector("[data-card-org-new-role]") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(/Sem pagador: a cobrança e a nota fiscal saem em nome de EE Celina Machado/)).toBeTruthy();
    const role = screen.getByLabelText("Papel de Rede Saber") as HTMLSelectElement;
    expect(role.value).toBe("mantenedora");
    fireEvent.change(role, { target: { value: "pagador" } });
    await Promise.resolve();
    expect(calls.at(-1)).toEqual({ method: "cards.organizations.setRole", params: { id: "c1", organizationId: "m", role: "pagador" } });
    fireEvent.click(screen.getByTitle("Tornar a organização principal"));
    await Promise.resolve();
    expect(calls.at(-1)!.method).toBe("cards.organizations.setPrimary");
    fireEvent.click(screen.getByTitle("Desvincular do cartão"));
    await Promise.resolve();
    expect(calls.at(-1)).toEqual({ method: "cards.organizations.remove", params: { id: "c1", organizationId: "m" } });
  });

  it("o pagador mostra que vai na cobrança e na nota", () => {
    render(<CardOrganizationsField cardId="c1" organizations={[org("e", "EE", "principal"), org("p", "Caixa Escolar", "pagador")]} run={async () => true} onOpen={() => {}} />);
    expect(document.body.textContent).toContain("Paga: vai na cobrança, na nota fiscal e na Gestão Financeira");
  });
});
