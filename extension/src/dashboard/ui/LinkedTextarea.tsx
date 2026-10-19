// Campo de texto longo que mostra os links clicáveis quando não está sendo
// editado (descrição da atividade). Clicar fora de um link volta a editar.
import { useRef, useState } from "react";
import { cn } from "@tailadmin";
import { LinkedText } from "./LinkedText";

export function LinkedTextarea({
  value,
  onChange,
  placeholder,
  className,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  if (editing || !value.trim()) {
    return (
      <textarea
        ref={ref}
        autoFocus={editing}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onBlur?.();
        }}
        onFocus={(e) => {
          if (!editing) setEditing(true);
          const end = e.target.value.length;
          e.target.setSelectionRange(end, end);
        }}
      />
    );
  }
  return (
    <div
      role="textbox"
      tabIndex={0}
      title="Clique para editar"
      data-linked-text
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(className, "cursor-text whitespace-pre-wrap break-words")}
    >
      <LinkedText text={value} />
    </div>
  );
}
