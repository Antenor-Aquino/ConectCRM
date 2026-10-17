// Mensagem de erro para mostrar ao usuário: as nossas já são em português;
// as que vêm do navegador, da rede ou de serviços externos (em inglês) são
// traduzidas pelas mais comuns.
const KNOWN: [RegExp, string][] = [
  [/failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|err_name_not_resolved/i, "Sem conexão com a internet ou o serviço não respondeu. Verifique a conexão e tente novamente."],
  [/receiving end does not exist|could not establish connection/i, "Não foi possível conectar ao banco local do CRM. Recarregue a página."],
  [/extension context invalidated/i, "A extensão foi atualizada. Recarregue a página."],
  [/did not approve|user denied|access_denied|user cancel+ed|canceled by the user|cancelled by the user|authorization page could not be loaded/i, "Login cancelado ou acesso não autorizado."],
  [/user interaction required|interaction_required|login_required|consent_required/i, "É preciso entrar na conta de novo: clique em Conectar."],
  [/invalid authentication credentials|invalid_grant|unauthenticated|invalid_token|token has been expired or revoked/i, "A conexão com a conta expirou. Conecte de novo."],
  [/<all_urls>|activeTab|cannot access contents of|cannot be scripted|chrome:\/\/|cannot access a chrome/i, "O Chrome não permite usar esta página (páginas internas do Chrome e da loja de extensões são bloqueadas). Abra o site desejado e tente de novo."],
  [/quotaexceedederror|exceeded the quota/i, "Sem espaço de armazenamento no navegador. Libere espaço (ou escolha uma pasta para os arquivos em Configurações → Documentos)."],
  [/quota|rate limit|too many requests/i, "Limite de uso do serviço atingido. Tente novamente em alguns minutos."],
  [/the operation was aborted|aborterror|timed? ?out/i, "O serviço demorou demais para responder. Tente novamente."],
  [/notallowederror|permission denied|not allowed by the user agent/i, "Permissão negada pelo navegador."],
];

export function translateError(message: string): string {
  for (const [re, pt] of KNOWN) if (re.test(message)) return pt;
  return message;
}

/** Texto do erro pronto para a tela. */
export function errorText(e: unknown): string {
  return translateError(e instanceof Error ? e.message : String(e));
}
