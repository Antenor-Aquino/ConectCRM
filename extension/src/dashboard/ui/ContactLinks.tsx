// Telefone e e-mail clicáveis: o telefone abre a conversa no WhatsApp Web; o
// e-mail abre o provedor cadastrado em Configurações → E-mail (com mais de
// um, mostra a escolha). O clique não abre o cartão por baixo.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mail, Settings } from "lucide-react";
import { cn } from "@tailadmin";
import { emailKindLabel, loadEmailProviders, openEmail, openWhatsApp, whatsappDigits, type EmailProvider } from "../../lib/contactLinks";
import { useSession } from "../session";

const LINK = "cursor-pointer text-left hover:text-brand-600 hover:underline dark:hover:text-brand-400";

export function PhoneLink({ phone, children, className }: { phone: string | null | undefined; children: ReactNode; className?: string }) {
  if (!whatsappDigits(phone)) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      title="Abrir conversa no WhatsApp"
      data-whatsapp={whatsappDigits(phone)}
      onClick={(e) => {
        e.stopPropagation();
        void openWhatsApp(phone!);
      }}
      className={cn(LINK, className)}
    >
      {children}
    </button>
  );
}

export function WebLink({ url, children, className }: { url: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Abrir o site ${url}`}
      data-site={url}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(LINK, className)}
    >
      {children}
    </a>
  );
}

/** Opção "computador" quando nada foi cadastrado. */
const FALLBACK: EmailProvider = { id: "padrao", kind: "padrao", name: "Aplicativo de e-mail do computador" };

export function EmailLink({ email, children, className }: { email: string; children: ReactNode; className?: string }) {
  const { user } = useSession();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState<{ list: EmailProvider[]; top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const go = async (p: EmailProvider) => {
    setOptions(null);
    if (await openEmail(p, email)) {
      // Link sem {email}: o endereço vai para a área de transferência.
      setCopied(true);
      setTimeout(() => setCopied(false), 3500);
    }
  };

  const click = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (options) return setOptions(null);
    const list = await loadEmailProviders(user.id);
    if (list.length === 1) return void go(list[0]!);
    const r = btn.current!.getBoundingClientRect();
    const width = 280;
    setOptions({ list, top: Math.min(r.bottom + 4, window.innerHeight - 220), left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
  };

  useEffect(() => {
    if (!options) return;
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOptions(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOptions(null);
    const off = (e: Event) => !menu.current?.contains(e.target as Node) && setOptions(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", off, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", off, true);
    };
  }, [options]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        title={`Escrever para ${email}`}
        data-email={email}
        onClick={(e) => void click(e)}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(LINK, className)}
      >
        {copied ? <span className="text-success-600">E-mail copiado — cole no destinatário</span> : children}
      </button>
      {options &&
        createPortal(
          <div
            ref={menu}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[9000] w-[280px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900"
            style={{ top: options.top, left: options.left }}
          >
            <p className="truncate px-2.5 pb-1 pt-1.5 text-theme-xs text-gray-500">Escrever para {email}</p>
            {(options.list.length ? options.list : [FALLBACK]).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void go(p)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-theme-sm text-gray-700 hover:bg-brand-50 hover:text-brand-700 dark:text-gray-300 dark:hover:bg-white/5"
              >
                <Mail size={15} className="shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.name !== emailKindLabel(p.kind) && p.kind !== "outro" && <span className="text-theme-xs text-gray-400">{emailKindLabel(p.kind)}</span>}
              </button>
            ))}
            {!options.list.length && (
              <p className="flex items-start gap-1.5 border-t border-gray-100 px-2.5 pb-1 pt-2 text-theme-xs text-gray-500 dark:border-gray-800">
                <Settings size={13} className="mt-0.5 shrink-0" /> Cadastre Gmail, Outlook ou outro em Configurações → E-mail.
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
