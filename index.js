const express = require('express');
const app = express();

// rota de teste
app.get('/status', (req, res) => {
  res.json({ message: 'Servidor rodando no Vercel com sucesso!' });
});

// exporta o app para o Vercel
module.exports = app;
