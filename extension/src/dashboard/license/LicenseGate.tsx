// Portão de licença: valida ao abrir o CRM (como o wa-pipedrive). Sem
// licença válida, mostra a tela de licença; em carência, libera com aviso.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { TaButton } from "@tailadmin";
import { extensionLicenseClient, inGracePeriod, type LicenseClient, type LicenseResult } from "../../lib/license";
import { LicenseScreen } from "./LicenseScreen";

interface LicenseCtx {
  result: LicenseResult;
  client: LicenseClient;
  refresh: () => Promise<void>;
  openScreen: () => void;
}

const Ctx = createContext<LicenseCtx | null>(null);

export function useLicense(): LicenseCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLicense fora do LicenseGate");
  return c;
}

const BYPASS = import.meta.env.VITE_LICENSE_BYPASS === "1";

export function LicenseGate({ children }: { children: ReactNode }) {
  const client = useMemo(() => extensionLicenseClient(), []);
  const [result, setResult] = useState<LicenseResult | null>(null);
  const [screen, setScreen] = useState(false);

  const refresh = useCallback(async () => {
    setResult(BYPASS ? { valida: true, dados: { plano: "dev" } } : await client.check());
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!result) {
    return <div className="flex min-h-screen items-center justify-center text-theme-sm text-gray-500">Verificando licença…</div>;
  }

  if (!result.valida || screen) {
    return (
      <LicenseScreen
        client={client}
        result={result}
        onBack={result.valida ? () => setScreen(false) : undefined}
        onActivated={async () => {
          await refresh();
          setScreen(false);
        }}
      />
    );
  }

  return (
    <Ctx.Provider value={{ result, client, refresh, openScreen: () => setScreen(true) }}>
      {inGracePeriod(result) && (
        <div className="flex items-center justify-center gap-3 bg-warning-50 px-4 py-2 text-theme-sm text-warning-800">
          <AlertTriangle size={16} />
          <span>
            <b>Pagamento pendente.</b> Houve uma falha na cobrança da sua assinatura. Regularize o cartão para não perder o acesso.
          </span>
          <TaButton
            size="sm"
            onClick={async () => {
              try {
                await chrome.tabs.create({ url: await client.billingPortalUrl() });
              } catch (e) {
                alert(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Atualizar pagamento
          </TaButton>
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}
