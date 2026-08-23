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
        container.innerHTML = "<p style='color:var(--cor-texto-secundario);'>Nenhuma alteração pendente de revisão no momento.</p>";
        return;
    }

    alteracoes.forEach(produto => {

        const bloco = document.createElement("div");
        bloco.className = "card";
        bloco.style.marginBottom = "16px";

        const ehIndisponivel = produto.tipoAlteracao === "indisponivel";
        const ehSugestao = produto.tipoAlteracao === "preco_sugerido";

        const dataFormatada = produto.dataVerificacao
            ? new Date(produto.dataVerificacao).toLocaleString("pt-BR")
            : "-";

        let rotulo = "PREÇO ATUALIZADO AUTOMATICAMENTE";
        let classeBadge = "badge-sucesso";
        let corpo = `<p style="font-size: 16px; margin-top:8px;">Preço anterior: <s>R$ ${produto.precoAnterior}</s> → Preço atual: <strong style="color:var(--cor-primaria);">R$ ${produto.preco}</strong></p>`;
        let botoesExtras = `<button onclick="marcarComoRevisado(${produto.id})">Marcar como revisado</button>`;

        if (ehIndisponivel) {

            rotulo = "PRODUTO FICOU INDISPONÍVEL (desativado)";
            classeBadge = "badge-perigo";
            corpo = `<p style="font-size: 14px; color: var(--cor-perigo); margin-top:8px;">Produto marcado como indisponível/esgotado pela verificação. Confira o link antes de reativar.</p>`;

        } else if (ehSugestao) {

            rotulo = "DIFERENÇA GRANDE DE PREÇO — PRECISA DA SUA CONFIRMAÇÃO";
            classeBadge = "badge-aviso";
            corpo = `<p style="font-size: 16px; margin-top:8px;">Preço atual no sistema: <strong>R$ ${produto.preco}</strong> → IA encontrou: <strong style="color:var(--cor-aviso);">R$ ${produto.precoSugerido}</strong></p><p style="font-size: 13px; color: var(--cor-texto-secundario);">Diferença grande demais pra aplicar sozinho — confira o link antes de confirmar.</p>`;
            botoesExtras = `
                <button onclick="aplicarSugestao(${produto.id}, ${produto.precoSugerido})" class="primario">Aplicar esse preço</button>
                <button onclick="marcarComoRevisado(${produto.id})">Ignorar sugestão</button>
            `;

        }

        bloco.innerHTML = `
            <span class="badge ${classeBadge}" style="margin-bottom:8px;">${rotulo}</span>
            <p style="font-size: 12px; color: var(--cor-texto-terciario); margin-top:6px;">Verificado em ${dataFormatada}</p>
            <h3 style="font-size: 15px; margin-top:8px; margin-bottom: 4px;">${produto.titulo}</h3>
            <p style="font-size: 13px; color: var(--cor-texto-secundario);">${produto.marketplace || "-"}</p>
            ${corpo}
            <div style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
                <a href="${produto.linkOriginal || produto.linkAfiliado}" target="_blank"><button type="button" class="botaoSecundario">Abrir produto</button></a>
                ${botoesExtras}
                <button onclick="editarProduto(${produto.id})">Editar</button>
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
// Rótulos amigáveis + o "tipo" visual (cor) de cada resultado, usados no
// log de atividade em tempo real.
// ======================================
function descreverResultado(evento) {

    switch (evento.resultadoTipo) {

        case 'preco_atualizado':
            return `preço atualizado: R$${evento.precoAntes} → R$${evento.precoDepois}`;

        case 'sugestao_pendente':
            return `diferença grande de preço (R$${evento.precoAntes} → R$${evento.precoDepois}), aguardando sua confirmação`;

        case 'indisponivel':
            return `ficou indisponível, desativado`;

        case 'nao_confirmado':
            return `não confirmado (link bloqueado/inacessível), nada foi alterado`;

        case 'falha':
            return `falha: ${evento.mensagemErro || 'erro desconhecido'}`;

        case 'sem_mudanca':
        default:
            return `sem alterações`;

    }

}

function tipoLogParaResultado(resultadoTipo) {

    switch (resultadoTipo) {
        case 'preco_atualizado': return 'sucesso';
        case 'sugestao_pendente': return 'aviso';
        case 'indisponivel': return 'aviso';
        case 'falha': return 'erro';
        default: return 'info';
    }

}

// ======================================
// Funções do log de atividade visual (substituem o antigo terminal preto):
// linhas de status coloridas por tipo, e um bloco recolhível com o prompt
// que foi enviado à IA pra cada produto verificado.
// ======================================
function adicionarLinhaLog(texto, tipo) {
    const areaStreaming = document.getElementById('areaStreaming');
    const linha = document.createElement('div');
    linha.className = `linhaLog linhaLog-${tipo || 'info'}`;
    linha.textContent = texto;
    areaStreaming.appendChild(linha);
    areaStreaming.scrollTop = areaStreaming.scrollHeight;
}

function mostrarPrompt(texto) {
    const areaStreaming = document.getElementById('areaStreaming');
    const bloco = document.createElement('details');
    bloco.className = 'blocoPrompt';
    const resumo = document.createElement('summary');
    resumo.textContent = 'Ver prompt enviado à IA';
    const pre = document.createElement('pre');
    pre.textContent = texto;
    bloco.appendChild(resumo);
    bloco.appendChild(pre);
    areaStreaming.appendChild(bloco);
    areaStreaming.scrollTop = areaStreaming.scrollHeight;
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
    mensagem.className = "mensagemFormulario";
    mensagem.textContent = "";
    areaStreaming.style.display = "block";
    areaStreaming.innerHTML = "";

    adicionarLinhaLog("Iniciando verificação...", "info");

    try {

        const resposta = await fetch("/api/verificacao/rodar-agora", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(produtoIds ? { produtoIds } : {})
        });

        if (!resposta.ok || !resposta.body) {
            adicionarLinhaLog("Erro ao conectar com o servidor.", "erro");
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
                        adicionarLinhaLog(`${dados.totalParaChecar} produto(s) para checar (${dados.semLinkOriginal} pulado(s) sem link original).`, "info");
                    }

                    if (dados.tipo === "prompt") {
                        mostrarPrompt(dados.texto);
                    }

                    if (dados.tipo === "produto") {
                        adicionarLinhaLog(`#${dados.produtoId} ${dados.titulo.slice(0, 50)} — ${descreverResultado(dados)}`, tipoLogParaResultado(dados.resultadoTipo));
                    }

                    if (dados.tipo === "final") {
                        const r = dados.resumo;
                        adicionarLinhaLog(`Concluído: ${r.totalVerificados} verificado(s), ${r.alteracoesEncontradas} alteração(ões) aplicada(s), ${r.sugestoesPendentes} sugestão(ões) aguardando confirmação, ${r.imagensCapturadas} imagem(ns) capturada(s), ${r.naoConseguiuAcessar} não confirmado(s), ${r.semLinkOriginal} sem link original, ${r.falhas} falha(s).`, "sucesso");
                        mensagem.className = "mensagemFormulario sucesso";
                        mensagem.textContent = "Verificação concluída — veja o resultado detalhado acima e a lista abaixo.";
                        carregarAlteracoes();
                    }

                }

                if (tipo === "erro") {
                    adicionarLinhaLog(`Erro: ${dados.mensagem}`, "erro");
                    mensagem.className = "mensagemFormulario erro";
                    mensagem.textContent = "A verificação parou por causa de um erro.";
                }

            }

        }

    } catch (erro) {

        adicionarLinhaLog(`Erro de conexão: ${erro.message}`, "erro");
        mensagem.className = "mensagemFormulario erro";
        mensagem.textContent = "Erro de conexão.";

    }

    botao.disabled = false;

}

document.getElementById("btnRodarAgora").addEventListener("click", rodarVerificacaoAgora);

carregarAlteracoes();