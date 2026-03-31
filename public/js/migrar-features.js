/* ==========================================================================
   migrar-features.js — Radar SIOPE
   Script de migração para popular a coleção "features" com dados existentes
   Execute uma vez no console do admin para migrar
   ========================================================================== */

'use strict';

/**
 * Migra as features hardcoded para a coleção dinâmica "features"
 * Execute no console do admin: migrarFeaturesExistentes()
 */
async function migrarFeaturesExistentes() {
  if (!window.db) {
    console.error('Firebase db não disponível');
    return;
  }

  const featuresExistentes = [
    {
      id: 'newsletter_texto',
      nome: 'Newsletter em texto',
      descricao: 'Acesso completo ao conteúdo das edições em formato texto',
      tipo: 'boolean',
      icone: '📝',
      ordem: 1,
      ativo: true
    },
    {
      id: 'newsletter_audio',
      nome: 'Newsletter em áudio (podcast)',
      descricao: 'Versão em áudio das edições para ouvir em qualquer lugar',
      tipo: 'boolean',
      icone: '🎧',
      ordem: 2,
      ativo: true
    },
    {
      id: 'newsletter_video',
      nome: 'Newsletter em vídeo',
      descricao: 'Conteúdo em vídeo com análise detalhada das edições',
      tipo: 'boolean',
      icone: '🎬',
      ordem: 3,
      ativo: true
    },
    {
      id: 'newsletter_infografico',
      nome: 'Infográfico por edição',
      descricao: 'Infográficos visuais complementando cada edição',
      tipo: 'boolean',
      icone: '📊',
      ordem: 4,
      ativo: true
    },
    {
      id: 'alertas_prioritarios',
      nome: 'Alertas prioritários',
      descricao: 'Notificações antecipadas sobre mudanças importantes',
      tipo: 'boolean',
      icone: '🔔',
      ordem: 5,
      ativo: true
    },
    {
      id: 'grupo_whatsapp_vip',
      nome: 'Grupo VIP WhatsApp',
      descricao: 'Acesso ao grupo exclusivo de discussão e networking',
      tipo: 'boolean',
      icone: '💬',
      ordem: 6,
      ativo: true
    },
    {
      id: 'biblioteca_acesso',
      nome: 'Biblioteca vitalícia',
      descricao: 'Acesso permanente a todo o acervo de edições passadas',
      tipo: 'boolean',
      icone: '📚',
      ordem: 7,
      ativo: true
    },
    {
      id: 'sugestao_tema_quota',
      nome: 'Sugestão de tema',
      descricao: 'Sugestões personalizadas de temas para reportagens',
      tipo: 'number',
      unidade: '/mês',
      icone: '💡',
      ordem: 8,
      ativo: true
    },
    {
      id: 'consultoria_horas_mes',
      nome: 'Consultoria direta',
      descricao: 'Horas de consultoria personalizada por mês',
      tipo: 'number',
      unidade: 'h',
      icone: '🎯',
      ordem: 9,
      ativo: true
    }
  ];

  console.log('Iniciando migração de features...');

  try {
    const batch = window.db.batch();

    for (const feature of featuresExistentes) {
      const docRef = window.db.collection('features').doc(feature.id);
      const docData = {
        ...feature,
        criado_em: new Date(),
        atualizado_em: new Date()
      };
      batch.set(docRef, docData);
    }

    await batch.commit();
    console.log(`✅ Migração concluída! ${featuresExistentes.length} features criadas.`);

    // Verificar se FeaturesManager está disponível e recarregar cache
    if (window.FeaturesManager) {
      await window.FeaturesManager.carregarFeatures();
      console.log('Cache de features atualizado.');
    }

  } catch (error) {
    console.error('❌ Erro na migração:', error);
  }
}

// Expor função globalmente
window.migrarFeaturesExistentes = migrarFeaturesExistentes;

console.log('Script de migração carregado. Execute migrarFeaturesExistentes() para migrar as features existentes.');