// @vitest-environment jsdom
// Arrastar e soltar (todo o sistema): mover itens, só pela alça, regra de onde pode soltar.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DragHandle, moveItem, moveKey, useDragSort } from "../src/dashboard/ui/dragSort";

afterEach(cleanup);

describe("ordem", () => {
  it("move para a posição do alvo (para cima e para baixo)", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveKey(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
});

function List({ groups }: { groups?: Record<string, string> }) {
  const [keys, setKeys] = useState(["a1", "a2", "b1", "b2"]);
  const drag = useDragSort({ onMove: (f, t) => setKeys((k) => moveKey(k, f, t)), canDrop: groups ? (f, t) => groups[f] === groups[t] : undefined });
  return (
    <ul>
      {keys.map((k, i) => {
        const rp = drag.rowProps(k);
        return (
          <li key={k} {...rp}>
            <DragHandle {...drag.handleProps(k, keys[i - 1], keys[i + 1])} />
            <input aria-label={k} defaultValue={k} />
          </li>
        );
      })}
    </ul>
  );
}

const dt = { setData: () => {}, effectAllowed: "", dropEffect: "" };
const order = () => [...document.querySelectorAll("li")].map((li) => li.getAttribute("data-drag-row"));
const drag = (from: string, to: string, viaHandle = true) => {
  const src = document.querySelector(`[data-drag-row="${from}"]`)!;
  if (viaHandle) fireEvent.mouseDown(src.querySelector("[data-drag-handle]")!);
  fireEvent.dragStart(src, { dataTransfer: dt });
  const dst = document.querySelector(`[data-drag-row="${to}"]`)!;
  fireEvent.dragOver(dst, { dataTransfer: dt });
  fireEvent.drop(dst, { dataTransfer: dt });
  fireEvent.dragEnd(src, { dataTransfer: dt });
};

describe("arrastar e soltar", () => {
  it("pela alça move; sem a alça (ex.: selecionando texto) não move", () => {
    render(<List />);
    drag("b2", "a1");
    expect(order()).toEqual(["b2", "a1", "a2", "b1"]);
    drag("a1", "b1", false);
    expect(order()).toEqual(["b2", "a1", "a2", "b1"]);
  });

  it("respeita onde pode soltar (ex.: mesma categoria) e o teclado", () => {
    render(<List groups={{ a1: "A", a2: "A", b1: "B", b2: "B" }} />);
    drag("b1", "a1");
    expect(order()).toEqual(["a1", "a2", "b1", "b2"]);
    drag("b2", "b1");
    expect(order()).toEqual(["a1", "a2", "b2", "b1"]);
    fireEvent.keyDown(document.querySelector('[data-drag-row="a1"] [data-drag-handle]')!, { key: "ArrowDown" });
    expect(order()).toEqual(["a2", "a1", "b2", "b1"]);
    // ↓ no último da categoria não atravessa para a outra.
    fireEvent.keyDown(document.querySelector('[data-drag-row="a1"] [data-drag-handle]')!, { key: "ArrowDown" });
    expect(order()).toEqual(["a2", "a1", "b2", "b1"]);
  });
});
