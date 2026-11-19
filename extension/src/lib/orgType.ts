// Tipo da organização no cadastro (mesmos valores dos papéis dela num cartão).
export type OrgType = "pagador" | "mantenedora" | "cliente" | "outra";
export const ORG_TYPES: OrgType[] = ["pagador", "mantenedora", "cliente", "outra"];
export const ORG_TYPE_LABEL: Record<OrgType, string> = { pagador: "Pagador", mantenedora: "Mantenedora", cliente: "Unidade / escola", outra: "Outra" };
