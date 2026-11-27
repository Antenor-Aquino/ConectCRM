// @vitest-environment jsdom
// Visão em lista: clicar na célula editável abre o editor e grava; as outras abrem o cartão.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { method: string; params: unknown }[] = [];
vi.mock("../src/rpc/client", () => ({
  call: vi.fn(async (method: string, params: unknown) => {
    calls.push({ method, params });
    if (method === "cards.get") return { id: "c1", kind: "deal", stage_id: "s1", value_cents: 0, value_from_items: 0, tags: [], customValues: {} };
    return null;
  }),
}));

import { BoardList } from "../src/dashboard/board/BoardList";
import type { BoardColumn } from "../src/db/deals";
import type { Pipeline } from "../src/db/pipelines";

afterEach(cleanup);

describe("lista editável", () => {
  it("edita o valor na célula sem abrir o cartão", async () => {
    const onOpen = vi.fn();
    const onChanged = vi.fn();
    const columns = [
      { id: "s1", name: "Prospect", color: null, count: 1, total_cents: 0, overdue_activities: 0, cards: [{ id: "c1", title: "Colégio", value_cents: 0, status: "open", fields: { valor: { text: "R$ 0,00" } } }] },
    ] as unknown as BoardColumn[];
    render(
      <BoardList
        pipeline={{ id: "p", type: "comercial" } as Pipeline}
        columns={columns}
        keys={["valor", "contato"]}
        options={[{ key: "valor", label: "Valor", group: "Negócio" }, { key: "contato", label: "Contato", group: "Contato" }]}
        onChangeKeys={() => {}}
        onOpenCard={onOpen}
        selected={new Set()}
        onToggleSelect={() => {}}
        onToggleMany={() => {}}
        onChanged={onChanged}
      />,
    );
    const cells = document.querySelectorAll("tbody td");
    // [checkbox, título, valor, contato]
    expect(cells[2]!.getAttribute("data-editable")).toBe("true");
    expect(cells[3]!.getAttribute("data-editable")).toBeNull();
    fireEvent.click(cells[3]!);
    expect(onOpen).toHaveBeenCalledWith("c1");
    onOpen.mockClear();
    fireEvent.click(cells[2]!);
    expect(onOpen).not.toHaveBeenCalled();
    const editor = await waitFor(() => {
      const el = document.querySelector("[data-list-cell-editor] input");
      if (!el) throw new Error("sem editor");
      return el as HTMLInputElement;
    });
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "1.290,77" } });
    fireEvent.blur(editor);
    fireEvent.click([...document.querySelectorAll("[data-list-cell-editor] button")].find((b) => b.textContent === "Salvar")!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "cards.update")?.params).toEqual({ id: "c1", patch: { valueCents: 129077 } });
    expect(document.querySelector("[data-list-cell-editor]")).toBeNull();
  });
});
