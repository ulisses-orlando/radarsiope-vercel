export default function handler(req, res) {
  res.status(200).json({ message: 'Servidor rodando no Vercel com sucesso!' });
}