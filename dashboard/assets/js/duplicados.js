let todosOsProdutos = [];

async function carregarDuplicados() {

    try {

        const resposta = await fetch("/api/produtos");

        todosOsProdutos = await resposta.json();

        renderizarDuplicados();

    } catch (erro) {

        console.error("Erro ao carregar produtos:", erro);

    }

}

function renderizarDuplicados() {

    const container = document.getElementById("listaDuplicados");

    container.innerHTML = "";

    const suspeitos = todosOsProdutos.filter(produto => produto.duplicataSuspeita);

    if (suspeitos.length === 0) {
        container.innerHTML = "<p>✅ Nenhum produto suspeito de duplicata no momento.</p>";
        return;
    }

    suspeitos.forEach(produtoSuspeito => {

        const original = todosOsProdutos.find(p => p.id === produtoSuspeito.duplicataDeId);

        const bloco = document.createElement("div");
        bloco.style.background = "white";
        bloco.style.borderRadius = "12px";
        bloco.style.padding = "20px";
        bloco.style.marginBottom = "20px";
        bloco.style.boxShadow = "0 3px 12px rgba(0,0,0,.08)";

        bloco.innerHTML = `
            <div style="display: flex; gap: 20px; flex-wrap: wrap;">

                <div style="flex: 1; min-width: 260px;">
                    <p style="font-size: 12px; color: #999; margin-bottom: 5px;">⚠️ PRODUTO NOVO (suspeito)</p>
                    <h3 style="font-size: 15px; margin-bottom: 10px;">${produtoSuspeito.titulo}</h3>
                    <p style="font-size: 13px; color: #666;">📂 ${produtoSuspeito.categoria || "Sem categoria"}</p>
                    <p style="font-size: 18px; font-weight: bold; color: #005744;">R$ ${produtoSuspeito.preco}</p>
                    <p style="font-size: 13px; color: #666;">🛒 ${produtoSuspeito.marketplace || "-"}</p>
                </div>

                <div style="flex: 1; min-width: 260px;">
                    <p style="font-size: 12px; color: #999; margin-bottom: 5px;">📦 PRODUTO ORIGINAL (já cadastrado)</p>
                    ${original ? `
                        <h3 style="font-size: 15px; margin-bottom: 10px;">${original.titulo}</h3>
                        <p style="font-size: 13px; color: #666;">📂 ${original.categoria || "Sem categoria"}</p>
                        <p style="font-size: 18px; font-weight: bold; color: #005744;">R$ ${original.preco}</p>
                        <p style="font-size: 13px; color: #666;">🛒 ${original.marketplace || "-"}</p>
                    ` : `<p style="color: #999;">Produto original não encontrado (pode ter sido excluído).</p>`}
                </div>

            </div>

            <div style="display: flex; gap: 10px; margin-top: 15px;">
                <button onclick="naoEhDuplicata(${produtoSuspeito.id})">✅ Não é duplicata (reativar)</button>
                <button onclick="editarProduto(${produtoSuspeito.id})">✏️ Editar</button>
                <button onclick="excluirProduto(${produtoSuspeito.id})">🗑️ Excluir produto novo</button>
            </div>
        `;

        container.appendChild(bloco);

    });

}

async function naoEhDuplicata(id) {

    try {

        const resposta = await fetch(`/api/produtos/${id}`, {

            method: "PUT",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                duplicataSuspeita: false,
                duplicataDeId: null,
                ativo: true
            })

        });

        const resultado = await resposta.json();

        if (resultado.sucesso) {

            carregarDuplicados();

        }

    } catch (erro) {

        console.error("Erro ao atualizar produto:", erro);

    }

}

function editarProduto(id) {

    window.location.href = `/editar-produto?id=${id}`;

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

            carregarDuplicados();

        }

    } catch (erro) {

        console.error("Erro ao excluir produto:", erro);

    }

}

carregarDuplicados();