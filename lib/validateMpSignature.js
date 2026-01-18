// lib/validateMpSignature.js
import crypto from 'crypto';

/**
 * Valida a assinatura Mercado Pago recebida no header x-signature.
 * @param {string} rawBody - corpo cru da requisição (string, byte‑a‑byte como recebido).
 * @param {string} signatureHeader - valor do header x-signature (ex: "ts=...,v1=...").
 * @returns {boolean} true se a assinatura for válida, false caso contrário.
 */
export function validateMpSignature(rawBody, signatureHeader) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;

  const v1Match = String(signatureHeader).match(/v1=([0-9a-fA-F]{64})/);
  const tsMatch = String(signatureHeader).match(/ts=([0-9]+)/);
  if (!v1Match || !tsMatch) return false;

  const v1Hex = v1Match[1];
  const ts = tsMatch[1];

  const secret = process.env.MP_WEBHOOK_SECRET || '';
  if (!secret) return false;

  // payload conforme especificado: `${ts}.${rawBody}`
  const payload = `${ts}.${String(rawBody)}`;

  // chave conforme orientação do suporte: UTF-8
  const key = Buffer.from(secret, 'utf8');

  // calcular HMAC
  const computed = crypto.createHmac('sha256', key).update(payload, 'utf8').digest();

  // expected buffer a partir do v1 hex
  let expected;
  try {
    expected = Buffer.from(v1Hex, 'hex');
  } catch (e) {
    return false;
  }

  if (expected.length !== computed.length) return false;

  // comparação segura
  return crypto.timingSafeEqual(computed, expected);
}
