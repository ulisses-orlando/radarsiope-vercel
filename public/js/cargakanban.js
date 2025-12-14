// Inserções iniciais no Firestore para o backlog
await backlogRef.add({
  titulo: "Tela de Orientações",
  descricao: "Criar aba/tela com explicações técnicas (Providers, Variáveis, Regras, Rate limiting, Checklist).",
  status: "concluido",
  dataCriacao: firebase.firestore.Timestamp.now()
});

await backlogRef.add({
  titulo: "Kanban Backlog",
  descricao: "Criar seção Kanban com três colunas e persistência no Firestore.",
  status: "andamento",
  dataCriacao: firebase.firestore.Timestamp.now()
});

await backlogRef.add({
  titulo: "Migração para SES",
  descricao: "Alterar provider de envio de e‑mail para Amazon SES em produção e configurar variáveis de ambiente.",
  status: "afazer",
  dataCriacao: firebase.firestore.Timestamp.now()
});

await backlogRef.add({
  titulo: "Otimização da Prévia",
  descricao: "Melhorar tela de prévia para mostrar apenas destinatários válidos e habilitar botão corretamente.",
  status: "afazer",
  dataCriacao: firebase.firestore.Timestamp.now()
});

await backlogRef.add({
  titulo: "Melhorias de UI",
  descricao: "Avaliar uso de accordion na tela de Orientações e contador de itens por coluna no Kanban.",
  status: "afazer",
  dataCriacao: firebase.firestore.Timestamp.now()
});
