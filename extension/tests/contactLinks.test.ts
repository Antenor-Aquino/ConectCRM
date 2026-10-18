import { describe, expect, it } from "vitest";
import { composeUrl, validProviderUrl, websiteUrl, whatsappDigits, whatsappSendUrl } from "../src/lib/contactLinks";

describe("links de contato", () => {
  it("telefone → conversa no WhatsApp Web", () => {
    expect(whatsappDigits("+5547999797906")).toBe("5547999797906");
    expect(whatsappDigits("(47) 9979-7906")).toBe("554799797906");
    expect(whatsappDigits("+1 415 555 0100")).toBe("14155550100");
    expect(whatsappDigits("123")).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappSendUrl("5547999797906")).toBe("https://web.whatsapp.com/send?phone=5547999797906");
  });

  it("e-mail → link do provedor", () => {
    const to = "antenor@stepple.com.br";
    const mk = (kind: Parameters<typeof composeUrl>[0]["kind"], url?: string) => composeUrl({ id: "x", kind, name: "x", url }, to);
    expect(mk("gmail")).toEqual({ url: "https://mail.google.com/mail/?view=cm&fs=1&to=antenor%40stepple.com.br", copy: false });
    expect(mk("outlook").url).toBe("https://outlook.office.com/mail/deeplink/compose?to=antenor%40stepple.com.br");
    expect(mk("outlook_pessoal").url).toContain("outlook.live.com");
    expect(mk("padrao").url).toBe("mailto:antenor@stepple.com.br");
    // Outro: {email} vira o destinatário; sem {email}, abre o link e copia o endereço.
    expect(mk("outro", "https://webmail.x.com/compose?to={email}")).toEqual({ url: "https://webmail.x.com/compose?to=antenor%40stepple.com.br", copy: false });
    expect(mk("outro", "https://mail.zoho.com/zm/#mail/folder/inbox")).toEqual({ url: "https://mail.zoho.com/zm/#mail/folder/inbox", copy: true });
  });

  it("valida o link do provedor", () => {
    expect(validProviderUrl("https://mail.zoho.com/zm/#mail/folder/inbox")).toBe(true);
    expect(validProviderUrl("mail.zoho.com")).toBe(false);
    expect(validProviderUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("site da organização", () => {
  it("vira link http(s)", () => {
    expect(websiteUrl("genialsoft.com.br")).toBe("https://genialsoft.com.br");
    expect(websiteUrl(" http://www.x.com/a ")).toBe("http://www.x.com/a");
    expect(websiteUrl("sem site")).toBeNull();
    expect(websiteUrl("")).toBeNull();
    expect(websiteUrl(null)).toBeNull();
  });
});
