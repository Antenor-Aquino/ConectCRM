// Várias contas Google: leitura do retorno do login do Google.
import { describe, expect, it } from "vitest";
import { parseGoogleRedirect } from "../src/lib/calendar";

const base = "https://fabjbdmhpofceejnkeffkkiomoeifedj.chromiumapp.org/google";

describe("login do Google (várias contas)", () => {
  it("lê o token e a validade", () => {
    expect(parseGoogleRedirect(`${base}#access_token=abc&expires_in=3599&state=s1&token_type=Bearer`, "s1")).toEqual({ token: "abc", expiresIn: 3599 });
  });
  it("recusa estado diferente, cancelamento e retorno sem token", () => {
    expect(() => parseGoogleRedirect(`${base}#access_token=abc&state=outro`, "s1")).toThrow(/segurança/);
    expect(() => parseGoogleRedirect(`${base}#error=access_denied&state=s1`, "s1")).toThrow(/cancelado/);
    expect(() => parseGoogleRedirect(`${base}#state=s1`, "s1")).toThrow(/não devolveu/);
  });
});
