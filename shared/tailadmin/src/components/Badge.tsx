import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import type { BadgeColor } from "../tokens";
import { badgePalette } from "../tokens";

const badgeColorMap: Record<BadgeColor, string> = {
  blue: "bg-brand-50 text-brand-600 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-400",
  purple: "bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-500/15 dark:text-purple-400",
  green: "bg-success-50 text-success-600 ring-success-200 dark:bg-success-500/15 dark:text-success-400",
  amber: "bg-warning-50 text-warning-600 ring-warning-200 dark:bg-warning-500/15 dark:text-warning-400",
  red: "bg-error-50 text-error-600 ring-error-200 dark:bg-error-500/15 dark:text-error-400",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  slate: "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300",
};

export function TaBadge({
  label,
  color = "slate",
  icon,
  active = true,
  onClick,
  title,
  className,
}: {
  label: string;
  color?: BadgeColor;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const p = badgePalette[color];
  const classes = cn(
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-theme-xs font-semibold ring-1 ring-inset",
    active ? badgeColorMap[color] : "bg-white text-gray-500 ring-gray-200",
    onClick && "cursor-pointer hover:opacity-90",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={classes} style={!active ? undefined : { background: p.bg, color: p.fg, borderColor: p.border }}>
        {icon}
        {label}
      </button>
    );
  }

  return (
    <span title={title} className={classes} style={active ? { background: p.bg, color: p.fg, borderColor: p.border } : undefined}>
      {icon}
      {label}
    </span>
  );
}
