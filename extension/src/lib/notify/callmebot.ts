// WhatsApp pelo CallMeBot (spec 10): mensagem para o PRÓPRIO número de quem
// ativou o serviço (grátis). Ativação: mandar "I allow callmebot to send me
// messages" para o número do CallMeBot no WhatsApp e copiar a chave recebida.
export const CALLMEBOT_ORIGIN = "https://api.callmebot.com/*";
export const CALLMEBOT_HELP = "https://www.callmebot.com/blog/free-api-whatsapp-messages/";

/** "+55 (41) 99999-8888" → "+5541999998888" (sem o 55, assume Brasil). */
export function callmebotPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return `+${d.length <= 11 ? `55${d}` : d}`;
}

export async function sendCallMeBot(phone: string, apikey: string, text: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const url = `https://api.callmebot.com/whatsapp.php?${new URLSearchParams({ phone: callmebotPhone(phone), text, apikey: apikey.trim() })}`;
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    throw new Error("Não foi possível falar com o CallMeBot (internet ou permissão de acesso).");
  }
  const body = (await res.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // O serviço responde 200 também em alguns erros: confere o texto.
  if (!res.ok || /apikey is invalid|invalid apikey|error|not allowed|wrong/i.test(body)) {
    if (/apikey/i.test(body)) throw new Error("CallMeBot: chave (apikey) inválida para este número.");
    throw new Error(`CallMeBot: ${body.slice(0, 140) || `erro ${res.status}`}`);
  }
}
