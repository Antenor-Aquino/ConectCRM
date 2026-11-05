// To Do: selo do vencimento e grupos do Planejado.
import { describe, expect, it } from "vitest";
import { dueLabel, plannedGroup } from "../src/lib/todo";

const today = "2026-11-05"; // quinta

describe("datas do To Do", () => {
  it("selo", () => {
    expect(dueLabel("2026-11-03", today)).toEqual({ text: "Atrasada · 03/11", tone: "danger" });
    expect(dueLabel("2026-11-05", today).text).toBe("Vence hoje");
    expect(dueLabel("2026-11-06", today).text).toBe("Vence amanhã");
    expect(dueLabel("2026-11-28", today).text).toBe("sáb., 28/11");
    expect(dueLabel("2027-01-04", today).text).toBe("seg., 04/01/2027");
  });
  it("grupos do Planejado", () => {
    expect(["2026-11-01", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"].map((d) => plannedGroup(d, today))).toEqual([
      "Atrasadas",
      "Hoje",
      "Amanhã",
      "Esta semana",
      "Depois",
    ]);
  });
});
