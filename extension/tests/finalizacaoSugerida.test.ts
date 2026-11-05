// Finalização sugerida ao clicar no campo: 5 min depois do início, no mesmo dia.
import { describe, expect, it } from "vitest";
import { suggestedEnd } from "../src/lib/taskTiming";

describe("finalização sugerida", () => {
  it("5 minutos depois do início", () => {
    expect(suggestedEnd(new Date(2026, 10, 4, 8, 0, 30))).toEqual(new Date(2026, 10, 4, 8, 5));
    expect(suggestedEnd(new Date(2026, 10, 4, 16, 58))).toEqual(new Date(2026, 10, 4, 17, 3));
  });
  it("não passa para o dia seguinte", () => {
    expect(suggestedEnd(new Date(2026, 10, 4, 23, 57))).toEqual(new Date(2026, 10, 4, 23, 59));
  });
});
