// To Do fase 3: regra de repetição (próxima data) e rótulos.
import { describe, expect, it } from "vitest";
import { nextDue, nextOccurrence, parseRecurrence, recurrenceLabel } from "../src/lib/todo";

describe("repetir do To Do", () => {
  it("próxima data", () => {
    expect(nextDue("2026-11-05", { every: 1, unit: "day" })).toBe("2026-11-06");
    expect(nextDue("2026-11-05", { every: 3, unit: "day" })).toBe("2026-11-08");
    expect(nextDue("2026-11-05", { every: 1, unit: "week" })).toBe("2026-11-12");
    // Dias da semana: sexta → segunda.
    expect(nextDue("2026-11-06", { every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] })).toBe("2026-11-09");
    expect(nextDue("2026-11-05", { every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] })).toBe("2026-11-06");
    // A cada 2 semanas, segunda e quarta: quarta 11/11 → segunda 23/11.
    expect(nextDue("2026-11-09", { every: 2, unit: "week", weekdays: [1, 3] })).toBe("2026-11-11");
    expect(nextDue("2026-11-11", { every: 2, unit: "week", weekdays: [1, 3] })).toBe("2026-11-23");
    expect(nextDue("2026-01-31", { every: 1, unit: "month" })).toBe("2026-02-28");
    expect(nextDue("2026-11-05", { every: 1, unit: "month" })).toBe("2026-12-05");
    expect(nextDue("2028-02-29", { every: 1, unit: "year" })).toBe("2029-02-28");
  });
  it("atrasada não gera outra atrasada", () => {
    expect(nextOccurrence("2026-10-30", { every: 1, unit: "day" }, "2026-11-05")).toBe("2026-11-05");
    expect(nextOccurrence("2026-10-01", { every: 1, unit: "month" }, "2026-11-05")).toBe("2026-12-01");
  });
  it("valida e rotula", () => {
    expect(parseRecurrence('{"every":0,"unit":"day"}')).toEqual({ every: 1, unit: "day" });
    expect(parseRecurrence({ every: 1, unit: "week", weekdays: [5, 1, 9, 1] })).toEqual({ every: 1, unit: "week", weekdays: [1, 5] });
    expect(parseRecurrence({ unit: "hour" })).toBeNull();
    expect(parseRecurrence("x")).toBeNull();
    expect(recurrenceLabel({ every: 1, unit: "day" })).toBe("Diariamente");
    expect(recurrenceLabel({ every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] })).toBe("Dias da semana");
    expect(recurrenceLabel({ every: 1, unit: "week", weekdays: [1, 3] })).toBe("Semanalmente (seg, qua)");
    expect(recurrenceLabel({ every: 2, unit: "month" })).toBe("A cada 2 meses");
  });
});
