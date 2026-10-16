import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

export interface TaButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "outline" | "ghost";
  size?: "sm" | "md";
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

export function TaButton({
  variant = "secondary",
  size = "sm",
  startIcon,
  endIcon,
  className,
  style,
  children,
  ...props
}: TaButtonProps) {
  const sizeClasses = {
    sm: "px-3.5 py-2 text-theme-sm",
    md: "px-5 py-2.5 text-theme-sm",
  };

  const variantClasses = {
    primary: "bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600 disabled:bg-brand-300",
    secondary: "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700",
    outline: "bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700",
    danger: "bg-white text-error-600 ring-1 ring-inset ring-error-200 hover:bg-error-50 dark:bg-gray-800 dark:text-error-400",
    ghost: "bg-transparent text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
  };

  return (
    <button
      {...props}
      style={style}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
    >
      {startIcon}
      {children}
      {endIcon}
    </button>
  );
}
