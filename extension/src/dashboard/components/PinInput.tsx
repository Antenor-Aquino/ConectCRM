// Digitação e conferência do PIN (tela de bloqueio e troca de usuário).
// "Esqueci o PIN": quem tem a chave de licença desta instalação remove o PIN.
import { useState } from "react";
import { TaButton, TaInput } from "@tailadmin";
import { call } from "../../rpc/client";
import { extensionLicenseClient, normalizeKey } from "../../lib/license";
import { ErrorText } from "../ui/form";
import { errorText } from "../../lib/errors";

export function PinCheck({ userId, onOk, autoFocus = true }: { userId: string; onOk: () => void; autoFocus?: boolean }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [licKey, setLicKey] = useState("");

  async function check() {
    setBusy(true);
    setError(null);
    try {
      if (await call("users.verifyPin", { id: userId, pin })) onOk();
      else {
        setError("PIN incorreto.");
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setError(null);
    const saved = await extensionLicenseClient().savedKey();
    if (!saved || normalizeKey(licKey) !== saved) {
      setError("A chave não confere com a licença desta instalação.");
      return;
    }
    // O próprio usuário (já é o usuário atual da sessão) remove o PIN.
    try {
      await call("users.setPin", { id: userId, pin: null });
      onOk();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (forgot) {
    return (
      <div>
        <p className="mb-2 text-theme-sm text-gray-600 dark:text-gray-300">Digite a chave de licença desta instalação para remover o PIN.</p>
        <TaInput autoFocus value={licKey} placeholder="CLAUDIACRM-XXXX-XXXX-XXXX" onChange={(e) => setLicKey(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <div className="mt-3 flex gap-2">
          <TaButton onClick={() => setForgot(false)}>Voltar</TaButton>
          <TaButton variant="primary" onClick={() => void reset()}>
            Remover PIN
          </TaButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TaInput
        autoFocus={autoFocus}
        type="password"
        inputMode="numeric"
        maxLength={6}
        placeholder="PIN"
        className="text-center text-lg tracking-[0.4em]"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && pin.length >= 4 && void check()}
      />
      <ErrorText>{error}</ErrorText>
      <TaButton variant="primary" className="mt-3 w-full" disabled={busy || pin.length < 4} onClick={() => void check()}>
        Entrar
      </TaButton>
      <button type="button" className="mt-3 w-full text-center text-theme-xs text-gray-500 hover:text-brand-600" onClick={() => setForgot(true)}>
        Esqueci o PIN
      </button>
    </div>
  );
}
