// Primeira abertura: cadastro do administrador (o primeiro usuário precisa
// ser administrador). Cadastro completo de usuários e PIN: Fase 3.
import { useState } from "react";
import { Workflow } from "lucide-react";
import { TaButton, TaInput } from "@tailadmin";
import { call } from "../../rpc/client";
import { ErrorText, Field } from "../ui/form";

export function FirstRunSetup({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      const id = await call("users.create", { name, email: email || null, role: "admin" });
      await chrome.storage.local.set({ "conectcrm-current-user": id });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-theme-md dark:border-gray-800 dark:bg-gray-900">
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white">
          <Workflow size={20} />
        </span>
        <h1 className="mb-1 text-theme-xl font-semibold text-gray-800 dark:text-white/90">Bem-vindo ao ConectCRM</h1>
        <p className="mb-6 text-theme-sm text-gray-500">Cadastre o administrador. Depois você poderá incluir gestores e vendedores.</p>
        <Field label="Seu nome" required>
          <TaInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
        </Field>
        <Field label="E-mail">
          <TaInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com.br" />
        </Field>
        <ErrorText>{error}</ErrorText>
        <TaButton variant="primary" size="md" className="mt-4 w-full" onClick={() => void save()}>
          Começar
        </TaButton>
      </div>
    </div>
  );
}
