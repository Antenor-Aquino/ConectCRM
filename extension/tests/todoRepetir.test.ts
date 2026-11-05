// To Do fase 3: regra de repetição (próxima data) e rótulos.
import { describe, expect, it } from "vitest";
import { nextDue, nextOccurrence, parseRecurrence, recurrenceLabel, sortTasks } from "../src/lib/todo";

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
  it("ordenar (fase 4)", () => {
    const t = (title: string, important: number, due_date: string | null, created_at: string) => ({ title, important, due_date, created_at });
    const list = [t("banana", 0, "2026-11-20", "2026-11-01"), t("Abacate", 1, null, "2026-11-03"), t("caju", 1, "2026-11-10", "2026-11-02"), t("item 10", 0, null, "2026-11-04"), t("item 9", 0, "2026-11-10", "2026-11-05")];
    const names = (by: Parameters<typeof sortTasks>[1], dir?: "asc" | "desc") => sortTasks(list, by, dir).map((x) => x.title);
    expect(names("manual")).toEqual(["banana", "Abacate", "caju", "item 10", "item 9"]);
    expect(names("importancia")).toEqual(["Abacate", "caju", "banana", "item 10", "item 9"]);
    expect(names("vencimento")).toEqual(["caju", "item 9", "banana", "Abacate", "item 10"]);
    expect(names("alfabetica")).toEqual(["Abacate", "banana", "caju", "item 9", "item 10"]);
    expect(names("alfabetica", "desc")).toEqual(["item 10", "item 9", "caju", "banana", "Abacate"]);
    expect(names("criacao")).toEqual(["item 9", "item 10", "Abacate", "caju", "banana"]);
  });
});
