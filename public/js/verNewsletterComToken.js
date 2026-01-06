// verNewsletterComToken.js
// Requer: window.db (Firestore) e firebase global para FieldValue

const db = window.db;

function normalizeParam(value) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (trimmed === "" || trimmed.toLowerCase().includes("sem envioid") || trimmed.includes("{{") || trimmed.includes("}}")) {
        return null;
    }
    return trimmed;
}

async function registrarCliqueBackground(env, uid, nid) {
    try {
        const clickUrl = `https://api.radarsiope.com.br/api/click?envioId=${encodeURIComponent(env)}&destinatarioId=${encodeURIComponent(uid)}&newsletterId=${encodeURIComponent(nid)}&url=${encodeURIComponent(window.location.href)}`;
        await fetch(clickUrl, { method: "GET", keepalive: true }).then(resp => {
            if (!resp.ok) {
                console.warn("Registro de clique retornou status:", resp.status);
            } else {
                console.log("Registro de clique enviado (status):", resp.status);
            }
        }).catch(err => {
            console.warn("Erro no fetch de registro de clique:", err);
        });
    } catch (err) {
        console.warn("Erro ao tentar registrar clique em background:", err);
    }
}

async function montarBlocos(newsletter, dados, segmento = null) {
    // ✅ HTML base da edição
    let htmlBase = newsletter.conteudo_html_completo || "";
    const blocos = newsletter.blocos || [];

    let htmlBlocos = "";

    // ✅ Monta blocos filtrados por segmento
    if (blocos.length > 0) {
        blocos.forEach(b => {
            // Filtra por segmento (lead/assinante)
            if (segmento && b.acesso !== "todos" && b.acesso !== segmento) return;

            htmlBlocos += b.html || "";
        });
    }

    let htmlFinal = "";

    if (blocos.length === 0) {
        // ✅ Sem blocos → usa apenas o HTML base
        htmlFinal = htmlBase;
    } else {
        // ✅ Com blocos → insere no {{blocos}} ou no final
        if (htmlBase.includes("{{blocos}}")) {
            htmlFinal = htmlBase.replace("{{blocos}}", htmlBlocos);
        } else {
            htmlFinal = htmlBase + "\n" + htmlBlocos;
        }
    }

    // ✅ Aplica placeholders reais do destinatário
    htmlFinal = aplicarPlaceholders(htmlFinal, dados);

    return htmlFinal;
}

async function VerNewsletterComToken() {
    // --- suporte a parâmetro ofuscado 'd' ---
    const params = new URLSearchParams(window.location.search);
    const d = params.get('d');
    if (d) {
        try {
            // decodifica URI component (caso tenha sido encodeURIComponent)
            const decodedUri = decodeURIComponent(d);
            // decodifica Base64 (atob no browser)
            const decoded = atob(decodedUri);
            // parsedQuery deve ser algo como "nid=...&env=...&uid=...&token=..."
            const parsedQuery = new URLSearchParams(decoded);
            for (const [k, v] of parsedQuery.entries()) {
                params.set(k, v);
            }
        } catch (err) {
            console.warn('Falha ao decodificar parâmetro ofuscado d:', err);
            // segue com params originais (fallback)
        }
    }
    // --- fim suporte 'd' ---

    const nid = normalizeParam(params.get("nid"));
    const env = normalizeParam(params.get("env"));
    const uid = normalizeParam(params.get("uid"));
    const token = params.get("token");
    const assinaturaId = normalizeParam(params.get("assinaturaId"));

    const container = document.getElementById("conteudo-newsletter");
    container.innerHTML = "<p>Validando acesso...</p>";

    // Validações iniciais de parâmetros
    if (!nid || !env || !uid || !token) {
        console.error("Parâmetros ausentes ou inválidos:", {
            nid, env, uid, token
        });
        container.innerHTML = `
            <div style="padding:16px;background:#fff3cd;color:#856404;border:1px solid #ffeeba;border-radius:6px;">
                <strong>Link inválido ou incompleto.</strong>
                <p>Verificamos que o link não contém todos os parâmetros necessários para abrir a edição. 
                Isso normalmente acontece quando o template do e-mail não foi preenchido corretamente.</p>
                <p>Se você recebeu este link por e-mail, peça o reenvio ou acesse o Painel do Assinante.</p>
            </div>
            `;
        return;
    }

    try {
        // 1. Buscar envio (path depende de assinaturaId)
        let envioRef;
        if (assinaturaId) {
            envioRef = db.collection("usuarios").doc(uid).collection("assinaturas").doc(assinaturaId).collection("envios").doc(env);
        } else {
            envioRef = db.collection("leads").doc(uid).collection("envios").doc(env);
        }

        const envioSnap = await envioRef.get();
        if (!envioSnap.exists) {
            console.warn("Envio não encontrado para:", { nid, env, uid, assinaturaId });
            container.innerHTML = "<p>Envio não encontrado para este destinatário.</p>";
            return;
        }
        const envio = envioSnap.data();

        // 2. Validar token e expiração
        if (!envio.token_acesso || envio.token_acesso !== token) {
            console.warn("Token inválido ou ausente no envio:", { expected: envio.token_acesso, provided: token });
            container.innerHTML = "<p>Acesso inválido: token incorreto.</p>";
            return;
        }

        if (envio.expira_em) {
            const expiraDate = typeof envio.expira_em.toDate === "function" ? envio.expira_em.toDate() : new Date(envio.expira_em);
            if (new Date() > expiraDate) {
                console.warn("Link expirado em:", expiraDate);
                container.innerHTML = "<p>Este link expirou. Solicite novo acesso.</p>";
                return;
            }
        }

        // 3. Atualizar metadados do envio (ultimo_acesso, acessos_totais)
        try {
            await envioRef.update({
                ultimo_acesso: new Date(),
                acessos_totais: firebase.firestore.FieldValue.increment(1)
            });
        } catch (err) {
            console.warn("Falha ao atualizar metadados do envio (não fatal):", err);
        }

        // Recarregar envio atualizado
        const envioAtualizadoSnap = await envioRef.get();
        const dadosEnvio = envioAtualizadoSnap.exists ? envioAtualizadoSnap.data() : envio;

        // 4. Buscar newsletter
        const newsletterSnap = await db.collection("newsletters").doc(nid).get();
        if (!newsletterSnap.exists) {
            console.warn("Newsletter não encontrada:", nid);
            container.innerHTML = "<p>Newsletter não encontrada.</p>";
            return;
        }
        const newsletter = newsletterSnap.data();

        // 5. Buscar destinatário
        let destinatarioSnap;
        let segmento = null;

        if (assinaturaId) {
            destinatarioSnap = await db.collection("usuarios").doc(uid).get();
            segmento = "assinantes";
        } else {
            destinatarioSnap = await db.collection("leads").doc(uid).get();
            segmento = "leads";
        }

        if (!destinatarioSnap.exists) {
            console.warn("Destinatário não encontrado:", uid);
            container.innerHTML = "<p>Destinatário não encontrado.</p>";
            return;
        }
        const destinatario = destinatarioSnap.data();

        // 6. Registrar view/clique em background (não bloqueante)
        registrarCliqueBackground(env, uid, nid);

        // 7. Verificar limiar de acessos
        const LIMIAR_ACESSOS = 5;
        const acessosTotais = (dadosEnvio && dadosEnvio.acessos_totais) ? Number(dadosEnvio.acessos_totais) : 0;
        if (acessosTotais > LIMIAR_ACESSOS) {
            try {
                await envioRef.update({ sinalizacao_compartilhamento: true });
            } catch (err) {
                console.warn("Falha ao sinalizar compartilhamento:", err);
            }
            container.innerHTML = `
                        <div style="font-family: Arial, sans-serif; color:#222; line-height:1.5; max-width:640px;">
                        <p style="font-weight:700; margin:0 0 8px 0;">
                            Atenção: Edição exclusiva para: <span style="font-weight:600;">${dados.nome}</span>
                        </p>

                        <p style="margin:8px 0;">
                            Identificamos múltiplos acessos a esta edição. Para preservar a segurança e a exclusividade do conteúdo, o acesso por link compartilhado pode ser limitado.
                        </p>

                        <p style="margin:8px 0;">
                            <strong>Se você é assinante:</strong> acesse a <strong>Biblioteca de Newsletters</strong> pela <strong>Área do Assinante</strong> para visualizar todas as edições de forma individual e segura.<br>
                            <a href="https://radarsiope-vercel.vercel.app/login.html" target="_blank" rel="noopener noreferrer" style="color:#0b66c3; text-decoration:none;">Entrar na Área do Assinante</a>
                        </p>

                        <p style="margin:8px 0;">
                            <strong>Se ainda não é assinante:</strong> convidamos você a fazer parte da nossa comunidade. Entre em contato para assinar ou esclarecer dúvidas:<br>
                            <a href="https://www.radarsiope.com.br/entre-em-contato" target="_blank" rel="noopener noreferrer" style="color:#0b66c3; text-decoration:none;">Entre em contato</a>
                        </p>

                        <p style="margin:12px 0 0 0; color:#555;">Agradecemos pela compreensão e pelo interesse em nosso conteúdo.</p>
                        </div>
                    `;
            return;
        }

        try {
            // 8. Montar placeholders e renderizar
            const dados = {
                nome: destinatario.nome || "",
                email: destinatario.email || "",
                edicao: newsletter.edicao || "",
                titulo: newsletter.titulo || ""
            };

            if (!newsletter.conteudo_html_completo) {
                console.warn("conteudo_html_completo ausente para newsletter:", nid);
                container.innerHTML = "<p>Newsletter sem conteúdo completo.</p>";
                return;
            }

            // const htmlFinal = aplicarPlaceholders(newsletter.conteudo_html_completo, dados);

            const htmlFinal = await montarBlocos(newsletter, dados, segmento);

            const watermark = `
                    <div style="font-size:12px;color:#888;text-align:center;margin:10px 0;">
                    Edição exclusiva para: ${dados.nome} · ${dados.email} · ${new Date().toLocaleString("pt-BR")}
                    </div>
                `;

            const bloqueioCss = `
                    <style>
                    .content, .footer { user-select: none; }
                    </style>
                `;

            const htmlComWatermark = `${bloqueioCss}${watermark}${htmlFinal}${watermark}`;
            container.innerHTML = htmlComWatermark;
        } catch (err) {
            console.error("Erro ao aplicar placeholders:", err);
            container.innerHTML = "<p>Erro ao montar newsletter.</p>";
        }

    } catch (err) {
        console.error("Erro geral ao validar acesso:", err);
        container.innerHTML = "<p>Erro ao validar acesso.</p>";
    }
}

// Executa
VerNewsletterComToken();
