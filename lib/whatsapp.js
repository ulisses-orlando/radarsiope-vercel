// lib/whatsapp.js
// Módulo utilitário para WhatsApp — SEM envio automático
// Usado por: pagamentoMP.js, alertas.js, frontend
//
// Funções:
// - gerarLinkWhatsApp(mensagem): retorna link wa.me com texto codificado
// - formatarNumero(numero): normaliza para E.164 (opcional, para logs)

/**
 * Gera link do WhatsApp Web com texto pré-preenchido
 * @param {string} texto - Mensagem a ser enviada
 * @returns {string} URL wa.me
 */
export function gerarLinkWhatsApp(texto) {
  if (!texto?.trim()) return 'https://web.whatsapp.com';
  const encoded = encodeURIComponent(texto.trim());
  return `https://web.whatsapp.com/send?text=${encoded}`;
}

/**
 * Normaliza número para formato E.164 (opcional, para auditoria)
 * @param {string} numero - Número em qualquer formato
 * @returns {string|null} Número normalizado ou null se inválido
 */
export function formatarNumero(numero) {
  if (!numero) return null;
  const digits = String(numero).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}