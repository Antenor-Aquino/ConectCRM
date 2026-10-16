import { badgePalette, cn, type BadgeColor } from "@tailadmin";
import { initials } from "../../lib/format";

const COLORS = Object.keys(badgePalette) as BadgeColor[];

function colorFor(seed: string): BadgeColor {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

/** Círculo com iniciais (contato, responsável). */
export function Avatar({ name, size = 20, className, title }: { name: string | null | undefined; size?: number; className?: string; title?: string }) {
  const c = badgePalette[colorFor(name ?? "?")];
  return (
    <span
      title={title ?? name ?? undefined}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", className)}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.4), background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
    >
      {initials(name)}
    </span>
  );
}
