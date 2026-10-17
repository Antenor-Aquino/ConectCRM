import { describe, expect, it } from "vitest";
import { isValidCnpj, normalizeEmail, normalizePhone, placeholderKeyFromName } from "../src/lib/validate";

describe("validações", () => {
  it("normaliza celular brasileiro para E.164", () => {
    expect(normalizePhone("(11) 99999-8888")).toBe("+5511999998888");
    expect(normalizePhone("5511999998888")).toBe("+5511999998888");
    expect(normalizePhone("+55 11 99999-8888")).toBe("+5511999998888");
    expect(normalizePhone("011 99999-8888")).toBe("+5511999998888");
    expect(normalizePhone("+55")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(() => normalizePhone("123")).toThrow(/Telefone inválido/);
  });

  it("usa o código do país escolhido", () => {
    expect(normalizePhone("912 345 678", "PT")).toBe("+351912345678");
  });

  it("valida e-mail", () => {
    expect(normalizeEmail(" Nome@Empresa.com.br ")).toBe("nome@empresa.com.br");
    expect(() => normalizeEmail("nome@")).toThrow(/E-mail inválido/);
  });

  it("valida CNPJ pelos dígitos verificadores", () => {
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
  });

  it("gera chave reservada a partir do nome", () => {
    expect(placeholderKeyFromName("Data de nascimento")).toBe("data_de_nascimento");
    expect(placeholderKeyFromName("  Filho(a) 1 ")).toBe("filho_a_1");
    expect(placeholderKeyFromName("Organização / Órgão")).toBe("organizacao_orgao");
  });
});
