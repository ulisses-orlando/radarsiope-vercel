const { enviarEmailLead } = require("./functions");

enviarEmailLead({
  nome: "Ulisses",
  email: "ulisses.orlando@gmail.com",
  mensagemHtml: "<p>Olá Ulisses, obrigado pelo seu interesse!</p>"
});
