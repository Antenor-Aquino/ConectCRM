// Som das notificações: qual som tocar (geral, por tipo, sem som, volume zero) e o horário sem som.
import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND, inQuietTime, soundFor, soundWithDefaults } from "../src/lib/notify/sounds";

const at = (hm: string) => new Date(`2026-10-22T${hm}:00`);

describe("som das notificações", () => {
  it("usa o som geral, ou o do tipo de aviso", () => {
    const s = soundWithDefaults({ sound: "marimba", perCategory: { overdue: "campainha" } });
    expect(soundFor(s, "reminder", at("10:00"))).toBe("marimba");
    expect(soundFor(s, "overdue", at("10:00"))).toBe("campainha");
  });

  it("sem som, volume zero ou no horário sem som: não toca", () => {
    expect(soundFor(soundWithDefaults({ sound: "none" }), "reminder", at("10:00"))).toBeNull();
    expect(soundFor(soundWithDefaults({ perCategory: { digest: "none" } }), "digest", at("10:00"))).toBeNull();
    expect(soundFor(soundWithDefaults({ volume: 0 }), "reminder", at("10:00"))).toBeNull();
    const quiet = soundWithDefaults({ quiet: { enabled: true, from: "20:00", to: "07:00" } });
    expect(soundFor(quiet, "reminder", at("22:30"))).toBeNull();
    expect(soundFor(quiet, "reminder", at("06:59"))).toBeNull();
    expect(soundFor(quiet, "reminder", at("07:00"))).toBe("sino");
  });

  it("horário sem som no mesmo dia e desligado", () => {
    expect(inQuietTime({ enabled: true, from: "12:00", to: "14:00" }, at("13:00"))).toBe(true);
    expect(inQuietTime({ enabled: true, from: "12:00", to: "14:00" }, at("14:00"))).toBe(false);
    expect(inQuietTime({ enabled: false, from: "00:00", to: "23:59" }, at("13:00"))).toBe(false);
  });

  it("padrão: Sino a 70%, sem repetir", () => {
    expect(DEFAULT_SOUND).toMatchObject({ sound: "sino", volume: 70, repeat: false });
  });
});
