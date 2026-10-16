// Ids gerados no cliente (UUID v4): evitam colisão entre computadores quando
// a sincronização existir (PLANEJAMENTO.md, seção 5.2).
export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
