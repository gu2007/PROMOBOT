async function carregarAlteracoes() {

    try {

        const resposta = await fetch("/api/produtos");
        const todosOsProdutos = await resposta.json();

        renderizarAlteracoes(todosOsProdutos.filter(p => p.alteracaoDetectada));

    } catch (erro) {

        console.error("Erro ao carregar produtos:", erro);

    }

}

function renderizarAlteracoes(alteracoes) {

    const container = document.getElementById("listaAlteracoes");

    container.innerHTML = "";

    if (alteracoes.length === 0) {
        container.innerHTML = "<p>✅ Nenhuma alteração pendente de revisão no momento.</p>";
        return;
    }

    alteracoes.forEach(produto => {

        const bloco = document.createElement("div");
        bloco.style.background = "white";
        bloco.style.borderRadius = "12px";
        bloco.style.padding = "20px";
        bloco.style.marginBottom = "20px";
        bloco.style.boxShadow = "0 3px 12px rgba(0,0,0,.08)";

        const ehIndisponivel = produto.tipoAlteracao === "indisponivel";
        const ehSugestao = produto.tipoAlteracao === "preco_sugerido";

        const dataFormatada = produto.dataVerificacao
            ? new Date(produto.dataVerificacao).toLocaleString("pt-BR")
            : "-";

        let rotulo = "💰 PREÇO ATUALIZADO AUTOMATICAMENTE";
        let corpo = `<p style="font-size: 16px;">Preço anterior: <s>R$ ${produto.precoAnterior}</s> → Preço atual: <strong style="color:#005744;">R$ ${produto.preco}</strong></p>`;
        let botoesExtras = `<button onclick="marcarComoRevisado(${produto.id})">✅ Marcar como revisado</button>`;

        if (ehIndisponivel) {

            rotulo = "🔴 PRODUTO FICOU INDISPONÍVEL (desativado)";
            corpo = `<p style="font-size: 14px; color: #c0392b;">Produto marcado como indisponível/esgotado pela verificação. Confira o link antes de reativar.</p>`;

        } else if (ehSugestao) {

            rotulo = "🟡 DIFERENÇA GRANDE DE PREÇO — PRECISA DA SUA CONFIRMAÇÃO";
            corpo = `<p style="font-size: 16px;">Preço atual no sistema: <strong>R$ ${produto.preco}</strong> → IA encontrou: <strong style="color:#c07800;">R$ ${produto.precoSugerido}</strong></p><p style="font-size: 13px; color: #666;">Diferença grande demais pra aplicar sozinho — confira o link antes de confirmar.</p>`;
            botoesExtras = `
                <button onclick="aplicarSugestao(${produto.id}, ${produto.precoSugerido})">✅ Aplicar esse preço</button>
                <button onclick="marcarComoRevisado(${produto.id})">🚫 Ignorar sugestão</button>
            `;

        }

        bloco.innerHTML = `
            <p style="font-size: 12px; color: #999; margin-bottom: 5px;">
                ${rotulo}
                &nbsp;·&nbsp; verificado em ${dataFormatada}
            </p>
            <h3 style="font-size: 15px; margin-bottom: 10px;">${produto.titulo}</h3>
            <p style="font-size: 13px; color: #666;">🛒 ${produto.marketplace || "-"}</p>
            ${corpo}
            <div style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
                <a href="${produto.linkOriginal || produto.linkAfiliado}" target="_blank"><button type="button">🔗 Abrir produto</button></a>
                ${botoesExtras}
                <button onclick="editarProduto(${produto.id})">✏️ Editar</button>
            </div>
        `;

        container.appendChild(bloco);

    });

}

async function marcarComoRevisado(id) {

    try {

        const resposta = await fetch(`/api/produtos/${id}`, {

            method: "PUT",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                alteracaoDetectada: false,
                tipoAlteracao: null,
                precoAnterior: null,
                precoSugerido: null
            })

        });

        const resultado = await resposta.json();

        if (resultado.sucesso) {

            carregarAlteracoes();

        }

    } catch (erro) {

        console.error("Erro ao atualizar produto:", erro);

    }

}

async function aplicarSugestao(id, novoPreco) {

    try {

        const resposta = await fetch(`/api/produtos/${id}`, {

            method: "PUT",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                preco: novoPreco,
                alteracaoDetectada: false,
                tipoAlteracao: null,
                precoSugerido: null
            })

        });

        const resultado = await resposta.json();

        if (resultado.sucesso) {

            carregarAlteracoes();

        }

    } catch (erro) {

        console.error("Erro ao aplicar sugestão:", erro);

    }

}

function editarProduto(id) {

    window.location.href = `/editar-produto?id=${id}`;

}

// ======================================
// Rótulos amigáveis pra cada tipo de resultado, usados no log em tempo real
// ======================================
function descreverResultado(evento) {

    switch (evento.resultadoTipo) {

        case 'preco_atualizado':
            return `💰 preço atualizado: R$${evento.precoAntes} → R$${evento.precoDepois}`;

        case 'sugestao_pendente':
            return `🟡 diferença grande de preço (R$${evento.precoAntes} → R$${evento.precoDepois}), aguardando sua confirmação`;

        case 'indisponivel':
            return `🔴 ficou indisponível, desativado`;

        case 'nao_confirmado':
            return `ℹ️ não confirmado (link bloqueado/inacessível), nada foi alterado`;

        case 'falha':
            return `❌ falha: ${evento.mensagemErro || 'erro desconhecido'}`;

        case 'sem_mudanca':
        default:
            return `✅ sem alterações`;

    }

}

// ======================================
// Roda a verificação e acompanha o progresso em tempo real (SSE), evitando
// que a tela fique "travada" esperando minutos sem feedback — o que estava
// causando a conexão cair em verificações com muitos produtos.
// ======================================
async function rodarVerificacaoAgora() {

    const botao = document.getElementById("btnRodarAgora");
    const mensagem = document.getElementById("mensagemVerificacao");
    const campoIds = document.getElementById("idsParaTestar");
    const areaStreaming = document.getElementById("areaStreaming");

    const textoIds = campoIds.value.trim();
    const produtoIds = textoIds
        ? textoIds.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n))
        : null;

    botao.disabled = true;
    mensagem.textContent = "";
    areaStreaming.style.display = "block";
    areaStreaming.textContent = "⏳ Iniciando verificação...\n";

    try {

        const resposta = await fetch("/api/verificacao/rodar-agora", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(produtoIds ? { produtoIds } : {})
        });

        if (!resposta.ok || !resposta.body) {
            areaStreaming.textContent += "\n❌ Erro ao conectar com o servidor.\n";
            botao.disabled = false;
            return;
        }

        const leitor = resposta.body.getReader();
        const decodificador = new TextDecoder();
        let bufferTexto = "";

        while (true) {

            const { done, value } = await leitor.read();

            if (done) break;

            bufferTexto += decodificador.decode(value, { stream: true });

            const partes = bufferTexto.split("\n\n");
            bufferTexto = partes.pop();

            for (const parte of partes) {

                const linhaEvento = parte.split("\n").find(l => l.startsWith("event:"));
                const linhaDados = parte.split("\n").find(l => l.startsWith("data:"));

                if (!linhaEvento || !linhaDados) continue;

                const tipo = linhaEvento.replace("event:", "").trim();
                const dados = JSON.parse(linhaDados.replace("data:", "").trim());

                if (tipo === "progresso") {

                    if (dados.tipo === "inicio") {
                        areaStreaming.textContent += `ℹ️ ${dados.totalParaChecar} produto(s) para checar (${dados.semLinkOriginal} pulado(s) sem link original).\n\n`;
                    }

                    if (dados.tipo === "produto") {
                        areaStreaming.textContent += `#${dados.produtoId} ${dados.titulo.slice(0, 50)} — ${descreverResultado(dados)}\n`;
                    }

                    if (dados.tipo === "final") {
                        const r = dados.resumo;
                        areaStreaming.textContent += `\n✅ Concluído: ${r.totalVerificados} verificado(s), ${r.alteracoesEncontradas} alteração(ões) aplicada(s), ${r.sugestoesPendentes} sugestão(ões) aguardando confirmação, ${r.imagensCapturadas} imagem(ns) capturada(s), ${r.naoConseguiuAcessar} não confirmado(s), ${r.semLinkOriginal} sem link original, ${r.falhas} falha(s).\n`;
                        mensagem.textContent = "✅ Verificação concluída — veja o resultado detalhado acima e a lista abaixo.";
                        carregarAlteracoes();
                    }

                }

                if (tipo === "erro") {
                    areaStreaming.textContent += `\n❌ Erro: ${dados.mensagem}\n`;
                    mensagem.textContent = "❌ A verificação parou por causa de um erro.";
                }

                areaStreaming.scrollTop = areaStreaming.scrollHeight;

            }

        }

    } catch (erro) {

        areaStreaming.textContent += `\n❌ Erro de conexão: ${erro.message}\n`;
        mensagem.textContent = "❌ Erro de conexão.";

    }

    botao.disabled = false;

}

document.getElementById("btnRodarAgora").addEventListener("click", rodarVerificacaoAgora);

carregarAlteracoes();