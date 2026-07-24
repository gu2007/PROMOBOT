let todosOsProdutos = [];

async function carregarProdutos() {

    try {

        const resposta = await fetch("/api/produtos");

        todosOsProdutos = await resposta.json();

        renderizarProdutos(todosOsProdutos);

    } catch (erro) {

        console.error("Erro ao carregar produtos:", erro);

    }

}

function renderizarProdutos(produtos) {

    const container = document.getElementById("secoesProdutos");

    container.innerHTML = "";

    if (produtos.length === 0) {
        container.innerHTML = "<p>Nenhum produto encontrado.</p>";
        return;
    }

    // Agrupa os produtos por marketplace
    const grupos = {};

    produtos.forEach(produto => {

        const chave = produto.marketplace || "Sem marketplace";

        if (!grupos[chave]) {
            grupos[chave] = [];
        }

        grupos[chave].push(produto);

    });

    // Renderiza uma seção por marketplace, cada uma com sua grade de cartões
    Object.keys(grupos).sort().forEach(marketplace => {

        const secao = document.createElement("section");
        secao.style.marginBottom = "40px";

        const titulo = document.createElement("h2");
        titulo.textContent = `${iconeMarketplace(marketplace)} ${marketplace} (${grupos[marketplace].length})`;
        titulo.style.marginBottom = "15px";
        titulo.style.color = "#005744";
        secao.appendChild(titulo);

        const grade = document.createElement("div");
        grade.className = "cards";

        grupos[marketplace].forEach(produto => {

            const linkSuspeito = !produto.linkAfiliado || produto.linkAfiliado === "LINK_NAO_CONFIRMADO" || !produto.linkAfiliado.startsWith("http");

            const cartao = document.createElement("div");
            cartao.className = "card";
            cartao.style.textAlign = "left";

            cartao.innerHTML = `
                <p style="font-size: 11px; color: #999; margin-bottom: 5px;">ID: ${produto.id}</p>
                <h3 style="font-size: 15px; margin-bottom: 10px; min-height: 40px;">${produto.titulo}</h3>
                <p style="font-size: 13px; color: #666; margin-bottom: 5px;">📂 ${produto.categoria || "Sem categoria"}</p>
                <p style="font-size: 20px; font-weight: bold; color: #005744; margin-bottom: 5px;">R$ ${produto.preco}</p>
                <p style="margin-bottom: 10px;">${produto.ativo ? "🟢 Ativo" : "🔴 Inativo"} ${linkSuspeito ? "⚠️ Link não verificado" : ""}</p>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <button onclick="editarProduto(${produto.id})">✏️ Editar</button>
                    <button onclick="alterarStatus(${produto.id})">${produto.ativo ? "⛔ Desativar" : "✅ Ativar"}</button>
                    <button onclick="excluirProduto(${produto.id})">🗑️ Excluir</button>
                </div>
            `;

            grade.appendChild(cartao);

        });

        secao.appendChild(grade);
        container.appendChild(secao);

    });

}

function iconeMarketplace(nome) {

    const nomeMinusculo = (nome || "").toLowerCase();

    if (nomeMinusculo.includes("mercado")) return "🛒";
    if (nomeMinusculo.includes("shopee")) return "🛍️";
    if (nomeMinusculo.includes("amazon")) return "📦";

    return "🏬";

}

function editarProduto(id) {

    window.location.href = `/editar-produto?id=${id}`;

}

async function alterarStatus(id) {

    try {

        const resposta = await fetch(`/api/produtos/${id}`, {

            method: "PATCH"

        });

        const resultado = await resposta.json();

        if (resultado.sucesso) {

            carregarProdutos();

        }

    } catch (erro) {

        console.error("Erro ao alterar status:", erro);

    }

}

async function excluirProduto(id) {

    const confirmar = confirm(

        "Deseja realmente excluir este produto?\n\nEsta ação não poderá ser desfeita."

    );

    if (!confirmar) {

        return;

    }

    try {

        const resposta = await fetch(`/api/produtos/${id}`, {

            method: "DELETE"

        });

        const resultado = await resposta.json();

        if (resultado.sucesso) {

            carregarProdutos();

        }

    } catch (erro) {

        console.error("Erro ao excluir produto:", erro);

    }

}

document.getElementById("filtroBusca").addEventListener("input", (evento) => {

    const termo = evento.target.value.toLowerCase();

    const filtrados = todosOsProdutos.filter(produto =>
        produto.titulo.toLowerCase().includes(termo)
    );

    renderizarProdutos(filtrados);

});

carregarProdutos();