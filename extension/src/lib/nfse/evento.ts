// Pedido de registro de evento da NFS-e Nacional — spec 20, B4.
// Por enquanto só o cancelamento (e101101). O XML sai sem assinatura: o
// ConectCRM Fiscal assina infPedReg com o certificado da empresa e envia
// (POST /nfse/{chave}/eventos). Esquema: pedRegEvento_v1.01.xsd.
import type { NfseEnvironment } from "../../db/nfse";
import { brasiliaDateTime, DPS_NAMESPACE, DPS_VERSION } from "./dps";

/** Código de justificativa do cancelamento (TSCodJustCanc). */
export type CancelReasonCode = 1 | 2 | 9;
export const CANCEL_REASONS: { code: CancelReasonCode; label: string }[] = [
  { code: 1, label: "Erro na emissão" },
  { code: 2, label: "Serviço não prestado" },
  { code: 9, label: "Outros" },
];
export const CANCEL_REASON_LABEL: Record<number, string> = Object.fromEntries(CANCEL_REASONS.map((r) => [r.code, r.label]));
/** Descrição do motivo: de 15 a 255 caracteres (TSMotivo). */
export const CANCEL_TEXT_MIN = 15;
export const CANCEL_TEXT_MAX = 255;
export const CANCEL_EVENT = "101101";

export interface CancelEventInput {
  accessKey: string;
  /** CNPJ do autor (o prestador que emitiu a nota). */
  cnpj: string;
  environment: NfseEnvironment;
  code: CancelReasonCode;
  reason: string;
  at: Date;
  appVersion: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Motivo limpo: sem caracteres de controle e espaços repetidos. */
export const cleanCancelText = (s: string) => s.replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim();

/** Erro de validação do pedido (texto para a tela) ou null. */
export function cancelInputError(code: number, reason: string): string | null {
  if (!CANCEL_REASON_LABEL[code]) return "Escolha o motivo do cancelamento.";
  const t = cleanCancelText(reason);
  if (t.length < CANCEL_TEXT_MIN) return `Descreva o motivo com pelo menos ${CANCEL_TEXT_MIN} caracteres.`;
  if (t.length > CANCEL_TEXT_MAX) return `A descrição do motivo aceita até ${CANCEL_TEXT_MAX} caracteres.`;
  return null;
}

/** Id do pedido: "PRE" + chave de acesso (50) + tipo do evento (6). */
export const cancelEventId = (accessKey: string) => `PRE${accessKey}${CANCEL_EVENT}`;

/** XML do pedido de cancelamento (sem assinatura). */
export function buildCancelEventXml(i: CancelEventInput): string {
  if (!/^\d{50}$/.test(i.accessKey)) throw new Error("Chave de acesso inválida para o cancelamento (são 50 dígitos).");
  const cnpj = i.cnpj.replace(/\D/g, "");
  if (cnpj.length !== 14) throw new Error("CNPJ da empresa emissora inválido.");
  const err = cancelInputError(i.code, i.reason);
  if (err) throw new Error(err);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<pedRegEvento xmlns="${DPS_NAMESPACE}" versao="${DPS_VERSION}"><infPedReg Id="${cancelEventId(i.accessKey)}">` +
    `<tpAmb>${i.environment === "producao" ? 1 : 2}</tpAmb>` +
    `<verAplic>${esc(i.appVersion.slice(0, 20))}</verAplic>` +
    `<dhEvento>${brasiliaDateTime(i.at)}</dhEvento>` +
    `<CNPJAutor>${cnpj}</CNPJAutor>` +
    `<chNFSe>${i.accessKey}</chNFSe>` +
    `<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>${i.code}</cMotivo><xMotivo>${esc(cleanCancelText(i.reason))}</xMotivo></e101101>` +
    `</infPedReg></pedRegEvento>`
  );
}
