// Janela de formulário que não fecha sem avisar: clicar fora, Esc ou X com algo
// digitado/alterado pergunta antes de descartar. Também registra o rascunho,
// então trocar de tela ou fechar o navegador avisa. (O botão Cancelar é uma
// escolha deliberada e continua descartando na hora.)
import { useEffect, useState, type ComponentProps } from "react";
import { TaModal } from "@tailadmin";
import { UnsavedDialog, useDraft } from "./unsaved";

type Props = ComponentProps<typeof TaModal> & {
  /** Texto da pergunta; padrão: o título da janela. */
  label?: string;
};

export function GuardedModal({ onClose, children, label, ...rest }: Props) {
  const [touched, setTouched] = useState(false);
  const [asking, setAsking] = useState(false);
  // Janela que fica montada e só fecha (isOpen = false): começa limpa na próxima abertura.
  useEffect(() => {
    if (!rest.isOpen) {
      setTouched(false);
      setAsking(false);
    }
  }, [rest.isOpen]);
  const text = label ?? (rest.title ? `${rest.title} (não salvo)` : "Formulário não salvo");
  useDraft(text, touched && rest.isOpen);
  return (
    <>
      <TaModal {...rest} onClose={() => (touched ? setAsking(true) : onClose())}>
        <div onInputCapture={() => setTouched(true)} onChangeCapture={() => setTouched(true)}>
          {children}
        </div>
      </TaModal>
      {asking && <UnsavedDialog items={[{ key: "this", scope: "this", label: text }]} confirmLabel="Descartar" onStay={() => setAsking(false)} onDiscard={onClose} />}
    </>
  );
}
