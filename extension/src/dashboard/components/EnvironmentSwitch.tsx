// Chave Produção / Teste no topo (como na gestao-financeira-extensao). Cada
// ambiente tem seu próprio banco; Teste já vem com dados de exemplo.
import { FlaskConical } from "lucide-react";
import { cn } from "@tailadmin";
import { systemCall } from "../../rpc/client";
import type { DbEnv } from "../../lib/environment";
import { CURRENT_KEY } from "../session";

export function EnvironmentSwitch({ env }: { env: DbEnv }) {
  const go = async (next: DbEnv) => {
    if (next === env) return;
    const msg =
      next === "demo"
        ? "Abrir o ambiente de TESTE? Ele tem dados de exemplo e não mistura com os seus dados reais."
        : "Voltar para o ambiente de PRODUÇÃO (seus dados reais)?";
    if (!confirm(msg)) return;
    // Cada ambiente lembra o próprio usuário atual.
    const saved = await chrome.storage.local.get([CURRENT_KEY, `${CURRENT_KEY}:${next}`]);
    await chrome.storage.local.set({ [`${CURRENT_KEY}:${env}`]: saved[CURRENT_KEY] ?? null, [CURRENT_KEY]: saved[`${CURRENT_KEY}:${next}`] ?? null });
    await systemCall("system.switchEnv", { env: next });
    location.reload();
  };
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-gray-100 p-0.5 text-theme-xs font-semibold dark:bg-white/5">
      <button
        type="button"
        onClick={() => void go("production")}
        className={cn("rounded-full px-3 py-1", env === "production" ? "bg-brand-500 text-white" : "text-gray-600 hover:text-gray-800 dark:text-gray-400")}
      >
        Produção
      </button>
      <button
        type="button"
        onClick={() => void go("demo")}
        className={cn("flex items-center gap-1 rounded-full px-3 py-1", env === "demo" ? "bg-warning-500 text-white" : "text-gray-600 hover:text-gray-800 dark:text-gray-400")}
      >
        <FlaskConical size={12} /> Teste
      </button>
    </div>
  );
}
