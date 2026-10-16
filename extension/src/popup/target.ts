// Cartão de destino escolhido no popup: fica guardado porque o popup fecha
// sempre que o usuário clica na página (ex.: ao fazer um recorte de tela).
import { useCallback, useEffect, useState } from "react";

const TARGET_KEY = "conectcrm-popup-target";

export function useTarget(): [string | null, (id: string | null) => void, boolean] {
  const [id, setId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void chrome.storage.local.get(TARGET_KEY).then((r) => {
      setId((r[TARGET_KEY] as string | undefined) ?? null);
      setLoaded(true);
    });
  }, []);
  const set = useCallback((next: string | null) => {
    setId(next);
    void (next ? chrome.storage.local.set({ [TARGET_KEY]: next }) : chrome.storage.local.remove(TARGET_KEY));
  }, []);
  return [id, set, loaded];
}
