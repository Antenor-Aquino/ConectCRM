/** "Maria José" + "Diretora" → "Maria José - Diretora" (campos marcados para aparecer junto com o nome). */
export const withExtra = (name: string, extra: string | null | undefined): string => (extra ? `${name} - ${extra}` : name);
