// Editor do modelo do lembrete para o contato (WhatsApp): texto com botões
// para inserir as variáveis e a prévia num balão como o do WhatsApp.
import { useRef } from "react";
import { RotateCcw } from "lucide-react";
import { CONTACT_TEMPLATE_DEFAULT, CONTACT_VARIABLES, renderContactMessage, type ContactVars } from "../../lib/notify/contactMessage";

export function ContactTemplateEditor({
  value,
  onChange,
  vars,
  now,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Dados para a prévia (reais na atividade; de exemplo em Configurações). */
  vars: ContactVars;
  /** Momento do envio (define "hoje/amanhã" na prévia). */
  now?: Date;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{${key}}`;
    if (!el) return onChange(value + token);
    const [a, b] = [el.selectionStart ?? value.length, el.selectionEnd ?? value.length];
    onChange(value.slice(0, a) + token + value.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };
  return (
    <div className="space-y-2" data-contact-template>
      <textarea
        ref={ref}
        rows={7}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Mensagem para o contato"
        className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-theme-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-500/10 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
      />
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1">
          {CONTACT_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              title={`${v.label} — ex.: ${v.example}`}
              onClick={() => insert(v.key)}
              className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
            >
              {`{${v.key}}`}
            </button>
          ))}
          {value !== CONTACT_TEMPLATE_DEFAULT && (
            <button type="button" onClick={() => onChange(CONTACT_TEMPLATE_DEFAULT)} className="ml-auto flex items-center gap-1 text-[11px] text-gray-500 hover:text-brand-600">
              <RotateCcw size={11} /> Modelo padrão
            </button>
          )}
        </div>
      )}
      <div className="rounded-xl bg-[#e5ddd5] p-3 dark:bg-[#0b141a]">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Prévia</p>
        <div className="ml-auto max-w-[95%] whitespace-pre-wrap break-words rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-[13px] leading-snug text-gray-800 shadow-sm dark:bg-[#005c4b] dark:text-white" data-contact-preview>
          {renderContactMessage(value, vars, now)}
        </div>
      </div>
    </div>
  );
}
