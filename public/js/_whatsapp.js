// =============================================================================
// api/_whatsapp.js — Módulo compartilhado de envio WhatsApp (Evolution API)
//
// NÃO é uma rota Vercel (underscore = ignorado pelo router).
// Importado por: pagamentoMP.js, alertas.js
//
// Variáveis de ambiente necessárias:
//   EVOLUTION_API_URL      → https://sua-instancia.up.railway.app
//   EVOLUTION_API_KEY      → chave definida no Railway (AUTHENTICATION_API_KEY)
//   EVOLUTION_INSTANCE     → radarsiope (nome da instância criada)
// =============================================================================

const EVOLUTION_URL      = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY      = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'radarsiope';

// ─── Normaliza número para formato Evolution API ──────────────────────────────
// Entrada:  "(61) 99999-8888" | "61999998888" | "+5561999998888"
// Saída:    "5561999998888"  (só dígitos, com DDI 55)
function _normalizarNumero(numero) {
  if (!numero) return null;
  const digits = String(numero).replace(/\D/g, '');
  // Já tem DDI 55
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  // Sem DDI — adiciona 55
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

// ─── Envia mensagem de texto simples ──────────────────────────────────────────
// Retorna { ok: true } ou { ok: false, erro: string }
export async function enviarWhatsApp(numero, texto, opcoes = {}) {
  const { tentativas = 2, timeoutMs = 8000 } = opcoes;

  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    console.warn('[whatsapp] Variáveis de ambiente não configuradas — envio ignorado.');
    return { ok: false, erro: 'Evolution API não configurada.' };
  }

  const numeroNorm = _normalizarNumero(numero);
  if (!numeroNorm) {
    console.warn('[whatsapp] Número inválido:', numero);
    return { ok: false, erro: 'Número inválido.' };
  }

  const url = `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`;

  for (let i = 0; i < tentativas; i++) {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey':        EVOLUTION_KEY,
        },
        body:   JSON.stringify({ number: numeroNorm, text: texto }),
        signal: ctrl.signal,
      });

      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        console.log(`[whatsapp] ✅ Enviado para ${numeroNorm.slice(-4).padStart(8, '*')}`);
        return { ok: true, data };
      }

      const errBody = await resp.text().catch(() => '');
      console.warn(`[whatsapp] Erro ${resp.status} (tentativa ${i + 1}):`, errBody.slice(0, 200));

      // 429 = rate limit → aguarda antes de tentar novamente
      if (resp.status === 429 && i < tentativas - 1) {
        await _sleep(3000);
        continue;
      }

      return { ok: false, erro: `HTTP ${resp.status}` };

    } catch (err) {
      clearTimeout(timeout);
      console.warn(`[whatsapp] Falha de rede (tentativa ${i + 1}):`, err.message);
      if (i < tentativas - 1) await _sleep(2000);
    }
  }

  return { ok: false, erro: 'Falha após todas as tentativas.' };
}

// ─── Envia para múltiplos números com intervalo (anti-ban) ───────────────────
// destinatarios: [{ numero, texto }]  — cada um pode ter texto diferente
// intervaloMs: pausa entre envios (padrão 1.2s — suficiente para evitar ban)
export async function enviarWhatsAppEmLote(destinatarios, intervaloMs = 1200) {
  if (!Array.isArray(destinatarios) || destinatarios.length === 0) {
    return { ok: true, enviados: 0, erros: 0 };
  }

  let enviados = 0;
  let erros    = 0;

  for (let i = 0; i < destinatarios.length; i++) {
    const { numero, texto } = destinatarios[i];
    const resultado = await enviarWhatsApp(numero, texto, { tentativas: 1, timeoutMs: 6000 });

    if (resultado.ok) enviados++;
    else erros++;

    // Pausa entre envios, exceto no último
    if (i < destinatarios.length - 1) await _sleep(intervaloMs);
  }

  console.log(`[whatsapp] Lote concluído: ${enviados} enviados, ${erros} erros de ${destinatarios.length} total.`);
  return { ok: true, enviados, erros, total: destinatarios.length };
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
