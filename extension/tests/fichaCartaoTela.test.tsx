// @vitest-environment jsdom
// Editar funil → Ficha do cartão: subir/descer, esconder, obrigatório fixo, restaurar.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DetailLayoutEditor } from "../src/dashboard/board/DetailLayoutEditor";
import { defaultDetailLayout, type DetailItem } from "../src/lib/detailLayout";
import type { CustomField } from "../src/db/customFields";
import type { Pipeline } from "../src/db/pipelines";

afterEach(cleanup);
const pipeline = { id: "p", name: "PowerCubus", type: "comercial" } as Pipeline;
const fields = [
  { id: "a", name: "Qtd de turmas", required: 0 },
  { id: "b", name: "Plano", required: 1 },
] as unknown as CustomField[];

function Host({ onItems }: { onItems: (i: DetailItem[]) => void }) {
  const [items, setItems] = useState(defaultDetailLayout("comercial", ["a", "b"]));
  onItems(items);
  return <DetailLayoutEditor pipeline={pipeline} fields={fields} items={items} onChange={setItems} />;
}

describe("Ficha do cartão (editor)", () => {
  it("muda a ordem, esconde e restaura; campo obrigatório não pode ser escondido", () => {
    let items: DetailItem[] = [];
    render(<Host onItems={(i) => (items = i)} />);
    const row = (key: string) => document.querySelector(`[data-detail-item="${key}"]`)!;
    expect(row("cf:a").textContent).toContain("Qtd de turmas");
    // Organização sobe duas posições.
    fireEvent.click(row("organizacao").querySelector('[title="Subir"]')!);
    fireEvent.click(row("organizacao").querySelector('[title="Subir"]')!);
    expect(items.map((i) => i.key).slice(1, 5)).toEqual(["secao:relacionamento", "organizacao", "contato", "outros_contatos"]);
    fireEvent.click(row("tags").querySelector("[data-detail-toggle]")!);
    expect(items.find((i) => i.key === "tags")).toEqual({ key: "tags", hidden: true });
    expect((row("cf:b").querySelector("[data-detail-toggle]") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(document.querySelector("[data-detail-reset]")!);
    expect(items).toEqual(defaultDetailLayout("comercial", ["a", "b"]));
  });
});
