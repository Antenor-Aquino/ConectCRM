// @vitest-environment jsdom
// "Quando" do lembrete do contato: número livre + unidade (min, horas, dias).
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LeadTimeInput, leadUnitOf } from "../src/dashboard/ui/LeadTimeInput";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup(initial: number) {
  const seen: number[] = [];
  let setOuter: (n: number) => void = () => {};
  function Host() {
    const [v, setV] = useState(initial);
    setOuter = setV;
    return <LeadTimeInput value={v} onChange={(m) => (seen.push(m), setV(m))} />;
  }
  const el = document.createElement("div");
  document.body.append(el);
  act(() => createRoot(el).render(<Host />));
  const input = el.querySelector("input")!;
  const select = el.querySelector("select")!;
  const type = (v: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const pick = (v: string) =>
    act(() => {
      select.value = v;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  return { input, select, type, pick, seen, setOuter: (n: number) => act(() => setOuter(n)) };
}

describe("LeadTimeInput", () => {
  it("unidade redonda do valor salvo", () => {
    expect(leadUnitOf(45)).toBe("min");
    expect(leadUnitOf(120)).toBe("h");
    expect(leadUnitOf(2880)).toBe("d");
    expect(leadUnitOf(0)).toBe("min");
  });

  it("aceita 1, 3, 7, 45 min e não pula para horas ao digitar 60", () => {
    const t = setup(15);
    expect(t.input.value).toBe("15");
    expect(t.select.value).toBe("min");
    for (const n of ["1", "3", "7", "45", "60"]) t.type(n);
    expect(t.seen).toEqual([1, 3, 7, 45, 60]);
    expect(t.select.value).toBe("min");
    expect(t.input.value).toBe("60");
  });

  it("trocar a unidade mantém o número (2 min → 2 horas → 2 dias)", () => {
    const t = setup(2);
    t.pick("h");
    t.pick("d");
    expect(t.seen).toEqual([120, 2880]);
    expect(t.input.value).toBe("2");
  });

  it("valor que chega de fora volta para a unidade redonda; limite de 30 dias", () => {
    const t = setup(15);
    t.setOuter(1440);
    expect(t.select.value).toBe("d");
    expect(t.input.value).toBe("1");
    t.type("90");
    expect(t.seen.at(-1)).toBe(60 * 24 * 30);
  });
});
