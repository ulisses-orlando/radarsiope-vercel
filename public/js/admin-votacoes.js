// ─── admin-votacoes.js ────────────────────────────────────────────────────
// Painel administrativo para acompanhar votações de sugestões de temas

async function carregarPainelVotacoesTemas() {
  const container = document.getElementById('votacoes-temas-content');
  if (!container) return;

  container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">Carregando dados de votações...</div>';

  try {
    const periodoAtual = new Date().toISOString().slice(0, 7); // YYYY-MM
    const dataAtual = new Date();
    const ano = dataAtual.getFullYear();
    const mes = dataAtual.getMonth(); // 0-based
    const periodoAnterior = mes === 0 ? `${ano - 1}-12` : `${ano}-${String(mes).padStart(2, '0')}`;

    // Buscar período atual
    const htmlAtual = await _renderSecaoVotacaoAtiva(periodoAtual);
    
    // Buscar período anterior encerrado
    const htmlAnterior = await _renderSecaoVotacaoEncerrada(periodoAnterior);
    
    // Buscar série histórica
    const htmlHistorico = await _renderSerieHistorica();

    const html = `
      <div style="margin-bottom: 40px;">
        ${htmlAtual}
      </div>
      <div style="margin-bottom: 40px;">
        ${htmlAnterior}
      </div>
      <div>
        ${htmlHistorico}
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    console.error('[admin-votacoes] erro ao carregar painel:', err);
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: #e53e3e;">
      Erro ao carregar votações. Tente novamente.
    </div>`;
  }
}

// ─── Renderiza seção de votação ativa (mês atual) ───────────────────────
async function _renderSecaoVotacaoAtiva(periodo) {
  try {
    const snap = await window.db.collection('sugestoes_publicas')
      .where('status', '==', 'ativa')
      .where('periodo', '==', periodo)
      .orderBy('votos', 'desc')
      .orderBy('criado_em', 'desc')
      .limit(5)
      .get();

    let html = '<h3 style="margin-top: 0; color: #0e7490;">📊 Votação Atual (' + _formatarPeriodo(periodo) + ')</h3>';

    if (snap.empty) {
      html += '<p style="color: #999;">Nenhuma sugestão ativa neste período.</p>';
      return html;
    }

    const sugestoes = await Promise.all(
      snap.docs.map(async doc => {
        const data = doc.data();
        const textoCompleto = await _buscarTextoSolicitacao(data.solicitacao_ref);
        return { id: doc.id, ...data, texto: textoCompleto };
      })
    );

    html += '<div style="display: grid; gap: 12px;">';
    sugestoes.forEach((sug, idx) => {
      const percentualVotos = snap.docs.length > 0 
        ? Math.round((sug.votos / Math.max(...snap.docs.map(d => d.data().votos || 1))) * 100)
        : 0;
      
      html += `
        <div style="
          background: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 12px;
          border-left: 4px solid #0e7490;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: #0e7490;">#${idx + 1}</strong>
            <div style="text-align: right;">
              <span style="
                background: #0e7490;
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-weight: bold;
                font-size: 14px;
              ">👍 ${sug.votos} voto${sug.votos !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <p style="margin: 8px 0; color: #333; line-height: 1.5;">${_esc(sug.texto)}</p>
          <div style="
            background: #e0e0e0;
            height: 6px;
            border-radius: 3px;
            overflow: hidden;
          ">
            <div style="
              background: #0e7490;
              height: 100%;
              width: ${percentualVotos}%;
              transition: width 0.3s ease;
            "></div>
          </div>
          <small style="color: #999; display: block; margin-top: 4px;">
            Data: ${new Date(sug.criado_em?.seconds ? sug.criado_em.seconds * 1000 : sug.criado_em).toLocaleDateString('pt-BR')}
          </small>
        </div>
      `;
    });
    html += '</div>';

    return html;
  } catch (err) {
    console.error('[admin-votacoes] erro ao renderizar votação ativa:', err);
    return '<p style="color: #e53e3e;">Erro ao carregar votação ativa.</p>';
  }
}

// ─── Renderiza seção de votação encerrada (mês anterior) ────────────────
async function _renderSecaoVotacaoEncerrada(periodo) {
  try {
    const snap = await window.db.collection('sugestoes_publicas')
      .where('status', '==', 'encerrada')
      .where('periodo', '==', periodo)
      .orderBy('votos', 'desc')
      .orderBy('criado_em', 'desc')
      .get();

    let html = '<h3 style="margin-top: 0; color: #16a34a;">🏅 Resultado Encerrado (' + _formatarPeriodo(periodo) + ')</h3>';

    if (snap.empty) {
      html += '<p style="color: #999;">Nenhuma votação encerrada neste período.</p>';
      return html;
    }

    const sugestoes = await Promise.all(
      snap.docs.map(async doc => {
        const data = doc.data();
        const textoCompleto = await _buscarTextoSolicitacao(data.solicitacao_ref);
        return { id: doc.id, ...data, texto: textoCompleto };
      })
    );

    // Usar ranking_final se disponível
    let rankingOrdenado = sugestoes;
    if (sugestoes[0]?.ranking_final) {
      rankingOrdenado = sugestoes[0].ranking_final.map(item => {
        const original = sugestoes.find(m => m.solicitacao_ref === item.solicitacao_ref);
        return original ? { ...original, posicao_fixa: item.posicao, votos_fixos: item.votos } : null;
      }).filter(Boolean);
    }

    html += '<div style="display: grid; gap: 12px;">';
    rankingOrdenado.slice(0, 5).forEach((sug, idx) => {
      const votos = sug.votos_fixos !== undefined ? sug.votos_fixos : sug.votos;
      const posicao = sug.posicao_fixa || idx + 1;
      const medalha = ['🥇', '🥈', '🥉', '', ''][posicao - 1] || '';

      html += `
        <div style="
          background: #f9f9f9;
          border: 1px solid #d4d4d4;
          border-radius: 8px;
          padding: 12px;
          border-left: 4px solid #16a34a;
          opacity: 0.9;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: #16a34a; font-size: 16px;">${medalha} #${posicao}</strong>
            <span style="
              background: #16a34a;
              color: white;
              padding: 4px 8px;
              border-radius: 12px;
              font-weight: bold;
              font-size: 14px;
            ">👍 ${votos} voto${votos !== 1 ? 's' : ''}</span>
          </div>
          <p style="margin: 8px 0; color: #333; line-height: 1.5;">${_esc(sug.texto)}</p>
          <small style="color: #999;">Encerrado em: ${new Date(sug.encerrado_em?.seconds ? sug.encerrado_em.seconds * 1000 : sug.encerrado_em).toLocaleDateString('pt-BR')}</small>
        </div>
      `;
    });
    html += '</div>';

    return html;
  } catch (err) {
    console.error('[admin-votacoes] erro ao renderizar votação encerrada:', err);
    return '<p style="color: #e53e3e;">Erro ao carregar votação encerrada.</p>';
  }
}

// ─── Renderiza série histórica ────────────────────────────────────────────
async function _renderSerieHistorica() {
  try {
    let html = '<h3 style="margin-top: 0; color: #7c3aed;">📈 Série Histórica de Votações</h3>';

    // Buscar todos os períodos encerrados
    const snap = await window.db.collection('sugestoes_publicas')
      .where('status', '==', 'encerrada')
      .orderBy('periodo', 'desc')
      .get();

    if (snap.empty) {
      html += '<p style="color: #999;">Nenhuma votação histórica disponível.</p>';
      return html;
    }

    // Agrupar por período
    const periodoMap = {};
    await Promise.all(
      snap.docs.map(async doc => {
        const data = doc.data();
        const periodo = data.periodo;
        if (!periodoMap[periodo]) {
          periodoMap[periodo] = [];
        }
        const textoCompleto = await _buscarTextoSolicitacao(data.solicitacao_ref);
        periodoMap[periodo].push({ id: doc.id, ...data, texto: textoCompleto });
      })
    );

    const periodos = Object.keys(periodoMap).sort().reverse();

    html += `
      <table style="
        width: 100%;
        border-collapse: collapse;
        background: #fff;
      ">
        <thead>
          <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
            <th style="padding: 10px; text-align: left;">Período</th>
            <th style="padding: 10px; text-align: left;">🥇 Vencedor</th>
            <th style="padding: 10px; text-align: right;">Total de Sugestões</th>
            <th style="padding: 10px; text-align: right;">Votos Totais</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const periodo of periodos) {
      const sugestoesDoPerido = periodoMap[periodo];
      const vencedor = sugestoesDoPerido[0];
      const totalSugestoes = sugestoesDoPerido.length;
      const totalVotos = sugestoesDoPerido.reduce((acc, sug) => acc + (sug.votos || 0), 0);

      html += `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 12px; font-weight: bold; color: #7c3aed;">${_formatarPeriodo(periodo)}</td>
          <td style="padding: 12px;">
            <div style="max-width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${_esc(vencedor.texto.substring(0, 50))}${vencedor.texto.length > 50 ? '...' : ''}
            </div>
          </td>
          <td style="padding: 12px; text-align: right;"><strong>${totalSugestoes}</strong></td>
          <td style="padding: 12px; text-align: right;"><strong>${totalVotos}</strong></td>
        </tr>
      `;
    }

    html += `
        </tbody>
      </table>
    `;

    return html;
  } catch (err) {
    console.error('[admin-votacoes] erro ao renderizar série histórica:', err);
    return '<p style="color: #e53e3e;">Erro ao carregar série histórica.</p>';
  }
}

// ─── Utilitários ──────────────────────────────────────────────────────────

function _formatarPeriodo(periodo) {
  const [ano, mes] = periodo.split('-');
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${meses[parseInt(mes) - 1]} ${ano}`;
}

async function _buscarTextoSolicitacao(solicitacaoPath) {
  try {
    const pathParts = solicitacaoPath.split('/');
    const uid = pathParts[1];
    const solicitacaoId = pathParts[3];

    const doc = await window.db.collection('usuarios').doc(uid)
      .collection('solicitacoes').doc(solicitacaoId).get();

    return doc.exists ? (doc.data().descricao || doc.data().texto || '') : '';
  } catch (err) {
    console.warn('[admin-votacoes] erro ao buscar texto:', err);
    return '';
  }
}

function _esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
