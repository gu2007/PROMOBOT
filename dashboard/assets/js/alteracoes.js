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

        const dataFormatada = produto.dataVerificacao
            ? new Date(produto.dataVerificacao).toLocaleString("pt-BR")
            : "-";

        bloco.innerHTML = `
            <p style="font-size: 12px; color: #999; margin-bottom: 5px;">
                ${ehIndisponivel ? "🔴 PRODUTO FICOU INDISPONÍVEL (desativado)" : "💰 PREÇO ATUALIZADO AUTOMATICAMENTE"}
                &nbsp;·&nbsp; verificado em ${dataFormatada}
            </p>
            <h3 style="font-size: 15px; margin-bottom: 10px;">${produto.titulo}</h3>
            <p style="font-size: 13px; color: #666;">🛒 ${produto.marketplace || "-"}</p>
            ${ehIndisponivel
                ? `<p style="font-size: 14px; color: #c0392b;">Produto marcado como indisponível/esgotado pela verificação. Confira o link antes de reativar.</p>`
                : `<p style="font-size: 16px;">Preço anterior: <s>R$ ${produto.precoAnterior}</s> → Preço atual: <strong style="color:#005744;">R$ ${produto.preco}</strong></p>`
            }
            <div style="display: flex; gap: 10px; margin-top: 15px;">
                <a href="${produto.linkAfiliado}" target="_blank"><button type="button">🔗 Abrir produto</button></a>
                <button onclick="marcarComoRevisado(${produto.id})">✅ Marcar como revisado</button>
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
                precoAnterior: null
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

function editarProduto(id) {

    window.location.href = `/editar-produto?id=${id}`;

}

async function rodarVerificacaoAgora() {

    const botao = document.getElementById("btnRodarAgora");
    const mensagem = document.getElementById("mensagemVerificacao");
    const campoIds = document.getElementById("idsParaTestar");

    const textoIds = campoIds.value.trim();
    const produtoIds = textoIds
        ? textoIds.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n))
        : null;

    botao.disabled = true;
    mensagem.textContent = produtoIds
        ? `⏳ Rodando verificação em ${produtoIds.length} produto(s) específico(s)...`
        : "⏳ Rodando verificação em todos os produtos ativos... isso pode levar alguns minutos.";

    try {

        const resposta = await fetch("/api/verificacao/rodar-agora", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(produtoIds ? { produtoIds } : {})
        });

        const dados = await resposta.json();

        if (dados.sucesso) {

            const r = dados.resumo;
            mensagem.textContent = `✅ Concluído: ${r.totalVerificados} verificado(s), ${r.alteracoesEncontradas} alteração(ões), ${r.naoConseguiuAcessar} não confirmado(s) (link bloqueado/inacessível, nada foi alterado), ${r.semLinkOriginal} sem link original cadastrado (pulado), ${r.falhas} falha(s).`;
            carregarAlteracoes();

        } else {

            mensagem.textContent = `❌ Erro: ${dados.mensagem}`;

        }

    } catch (erro) {

        mensagem.textContent = `❌ Erro de conexão: ${erro.message}`;

    }

    botao.disabled = false;

}

document.getElementById("btnRodarAgora").addEventListener("click", rodarVerificacaoAgora);

carregarAlteracoes();