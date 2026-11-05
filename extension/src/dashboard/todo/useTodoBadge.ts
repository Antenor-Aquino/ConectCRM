// Contador do menu "To Do" (spec 15, fase 3): abertas no Meu Dia, vencidas ou
// que vencem hoje e com lembrete que já chegou. Atualiza a cada minuto e
// quando o To Do (ou outra tela) muda dados.
import { useEffect, useState } from "react";
import { call, DATA_CHANGED_EVENT } from "../../rpc/client";

export const TODO_CHANGED_EVENT = "conectcrm-todo-changed";

export function useTodoBadge(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void call("todo.badge")
        .then((v) => alive && setN(v))
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener(DATA_CHANGED_EVENT, load);
    window.addEventListener(TODO_CHANGED_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(DATA_CHANGED_EVENT, load);
      window.removeEventListener(TODO_CHANGED_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, []);
  return n;
}
