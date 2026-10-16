// Usuário atual: assina as alterações, define "Meu fluxo"/"Minha equipe" e
// as permissões. Na primeira abertura pede o cadastro do administrador.
// (Seleção protegida por PIN entra na Fase 3.)
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { call, setCurrentUser } from "../rpc/client";
import { userLabel, type User } from "../db/users";

const STORAGE_KEY = "conectcrm-current-user";

interface Session {
  user: User;
  users: User[];
  /** "Antenor (Você)" / "Ana (vendedor)". */
  label: (u: Pick<User, "id" | "name" | "role">) => string;
  switchUser: (id: string) => Promise<void>;
  reloadUsers: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession fora do SessionProvider");
  return s;
}

export function SessionProvider({ children, setup }: { children: ReactNode; setup: (onDone: () => void) => ReactNode }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const reloadUsers = useCallback(async () => {
    const list = await call("users.list", {});
    setUsers(list);
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as string | undefined;
    const current = list.find((u) => u.id === stored) ?? list.find((u) => u.role === "admin") ?? list[0];
    setCurrentUser(current?.id ?? null);
    setUserId(current?.id ?? null);
  }, []);

  useEffect(() => {
    void reloadUsers();
  }, [reloadUsers]);

  const switchUser = useCallback(async (id: string) => {
    await chrome.storage.local.set({ [STORAGE_KEY]: id });
    setCurrentUser(id);
    setUserId(id);
  }, []);

  if (users === null) return null;
  const user = users.find((u) => u.id === userId);
  if (!user) return <>{setup(() => void reloadUsers())}</>;

  return (
    <SessionContext.Provider value={{ user, users, label: (u) => userLabel(u, user.id), switchUser, reloadUsers }}>
      {children}
    </SessionContext.Provider>
  );
}
