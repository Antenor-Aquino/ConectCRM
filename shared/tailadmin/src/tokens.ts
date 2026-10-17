// Tokens de design compatíveis com o antigo extension/src/dashboard/theme.ts
// (mesmos nomes/formatos) - permite que código que ainda importa cores/raio
// "cru" (fora de className, ex.: canvas do Chart.js, estilos inline
// pontuais) continue funcionando sem precisar migrar tudo pra classes
// Tailwind de uma vez. Os valores de cor batem com a paleta TailAdmin
// (brand/success/warning/error) definida em src/index.css via @theme.

export const colors = {
  bg: "#F9FAFB",
  bgSubtle: "#F3F4F6",
  card: "#FFFFFF",
  border: "#E4E7EC",
  borderLight: "#F2F4F7",
  primary: "#465FFF",
  primaryHover: "#3641F5",
  primaryActive: "#2A31D8",
  success: "#16A34A",
  successBg: "#F0FDF4",
  error: "#DC2626",
  errorBg: "#FEF2F2",
  textPrimary: "#1D2939",
  textSecondary: "#667085",
  textMuted: "#98A2B3",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const shadow = {
  xs: "0 1px 2px rgba(16,24,40,0.05)",
  sm: "0 4px 12px rgba(16,24,40,0.10)",
  md: "0 8px 24px rgba(16,24,40,0.12)",
  lg: "0 20px 50px rgba(16,24,40,0.18)",
  drawer: "-8px 0 24px rgba(16,24,40,0.10)",
} as const;

export const transition = { fast: "200ms ease" } as const;

export const zIndex = { dropdown: 20, overlay: 99999, popover: 100 } as const;

export const badgePalette = {
  blue: { bg: "#ECF3FF", fg: "#3641F5", border: "#DDE9FF" },
  purple: { bg: "#F5F3FF", fg: "#6D28D9", border: "#DDD6FE" },
  green: { bg: "#F0FDF4", fg: "#15803D", border: "#BBF7D0" },
  amber: { bg: "#FFFBEB", fg: "#B45309", border: "#FDE68A" },
  red: { bg: "#FEF2F2", fg: "#B91C1C", border: "#FECACA" },
  cyan: { bg: "#ECFEFF", fg: "#0E7490", border: "#A5F3FC" },
  slate: { bg: "#F3F4F6", fg: "#475569", border: "#E4E7EC" },
} as const;

export type BadgeColor = keyof typeof badgePalette;
