// A integração com a Gestão Financeira está ativada? (abas, relatórios e
// avisos financeiros só aparecem com ela.) null = ainda carregando.
import { useEffect, useState } from "react";
import { gfIntegrationActive, loadGfSettings, onGfSettingsChange } from "../lib/finance/gfBridge";

export function useGfActive(): boolean | null {
  const [active, setActive] = useState<boolean | null>(null);
  useEffect(() => {
    void loadGfSettings().then((s) => setActive(gfIntegrationActive(s)));
    return onGfSettingsChange((s) => setActive(gfIntegrationActive(s)));
  }, []);
  return active;
}
