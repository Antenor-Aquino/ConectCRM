// Usuário atual: assina as alterações, define "Meu fluxo"/"Minha equipe" e
// as permissões. Na primeira abertura pede o cadastro do administrador.
// Usuário com PIN precisa digitá-lo ao abrir o CRM (uma vez por sessão do
// navegador) e ao ser escolhido na troca de usuário.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { call, setCurrentUser } from "../rpc/client";
import { userLabel, type User } from "../db/users";

export const CURRENT_KEY = "conectcrm-current-user";
const UNLOCKED_KEY = "conectcrm-unlocked-user";

interface Session {
  user: User;
  users: User[];
  /** "Antenor (Você)" / "Ana (vendedor)". */
  label: (u: Pick<User, "id" | "name" | "role">) => string;
  /** Troca de usuário; quem tem PIN só entra depois de `unlock` (ver UserSwitcher). */
  switchUser: (id: string) => Promise<void>;
  /** Marca o usuário como desbloqueado nesta sessão do navegador. */
  unlock: (id: string) => Promise<void>;
  lock: () => Promise<void>;
  reloadUsers: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession fora do SessionProvider");
  return s;
}

async function sessionGet(key: string): Promise<string | undefined> {
  try {
    return (await chrome.storage.session.get(key))[key] as string | undefined;
  } catch {
    return undefined;
  }
}

export function SessionProvider({
  children,
  setup,
  locked,
}: {
  children: ReactNode;
  setup: (onDone: () => void) => ReactNode;
  /** Tela de PIN para o usuário atual. */
  locked: (user: User, session: Pick<Session, "unlock" | "switchUser" | "users">) => ReactNode;
}) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [unlockedId, setUnlockedId] = useState<string | null>(null);

  const reloadUsers = useCallback(async () => {
    const list = await call("users.list", {});
    setUsers(list);
    const stored = (await chrome.storage.local.get(CURRENT_KEY))[CURRENT_KEY] as string | undefined;
    const current = list.find((u) => u.id === stored) ?? list.find((u) => u.role === "admin") ?? list[0];
    // Usuário guardado não existe neste banco (troca de ambiente, restauração): fixa o novo.
    if (current && current.id !== stored) await chrome.storage.local.set({ [CURRENT_KEY]: current.id });
    setCurrentUser(current?.id ?? null);
    setUserId(current?.id ?? null);
    setUnlockedId((await sessionGet(UNLOCKED_KEY)) ?? null);
  }, []);

  useEffect(() => {
    void reloadUsers();
  }, [reloadUsers]);

  const switchUser = useCallback(async (id: string) => {
    await chrome.storage.local.set({ [CURRENT_KEY]: id });
    setCurrentUser(id);
    setUserId(id);
  }, []);

  const unlock = useCallback(async (id: string) => {
    try {
      await chrome.storage.session.set({ [UNLOCKED_KEY]: id });
    } catch {
      /* sem storage.session: vale só enquanto a aba estiver aberta */
    }
    setUnlockedId(id);
  }, []);

  const lock = useCallback(async () => {
    try {
      await chrome.storage.session.remove(UNLOCKED_KEY);
    } catch {
      /* idem */
    }
    setUnlockedId(null);
  }, []);

  if (users === null) return null;
  const user = users.find((u) => u.id === userId);
  if (!user) return <>{setup(() => void reloadUsers())}</>;
  if (user.has_pin && unlockedId !== user.id) return <>{locked(user, { unlock, switchUser, users })}</>;

  return (
    <SessionContext.Provider value={{ user, users, label: (u) => userLabel(u, user.id), switchUser, unlock, lock, reloadUsers }}>
      {children}
    </SessionContext.Provider>
  );
}
