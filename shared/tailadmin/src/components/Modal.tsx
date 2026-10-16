import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../utils/cn";

export function TaModal({
  isOpen,
  onClose,
  title,
  accent,
  width = "max-w-lg",
  children,
  showCloseButton = true,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  accent?: string;
  width?: string;
  children: ReactNode;
  showCloseButton?: boolean;
}) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    if (isOpen) document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center overflow-y-auto p-4">
      <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={modalRef}
        className={cn("relative w-full rounded-2xl bg-white shadow-theme-xl dark:bg-gray-900", width)}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div
            className="flex items-center justify-between rounded-t-2xl px-5 py-4"
            style={{ background: accent ?? "var(--color-brand-500)" }}
          >
            {title && <h3 className="text-base font-semibold text-white">{title}</h3>}
            {showCloseButton && (
              <button type="button" onClick={onClose} className="ml-auto text-white/90 hover:text-white">
                <X size={20} />
              </button>
            )}
          </div>
        )}
        <div className="max-h-[85vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function TaDrawer({
  isOpen,
  onClose,
  title,
  children,
  footer,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex justify-end">
      <div className="fixed inset-0 bg-gray-900/50" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full max-w-[340px] flex-col bg-white shadow-theme-xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-gray-200 p-5 dark:border-gray-800">{footer}</div>}
      </div>
    </div>
  );
}
