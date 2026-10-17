// Nomes das cores (etapas, tags, avatares) para exibir ao usuário.
import type { BadgeColor } from "@tailadmin";

export const COLOR_LABEL: Record<BadgeColor, string> = {
  blue: "Azul",
  purple: "Roxo",
  green: "Verde",
  amber: "Âmbar",
  red: "Vermelho",
  cyan: "Ciano",
  slate: "Cinza",
};

export const colorLabel = (c: string): string => COLOR_LABEL[c as BadgeColor] ?? c;
