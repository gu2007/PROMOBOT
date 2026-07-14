async function carregarProdutos() {

    try {

        const resposta = await fetch("/api/produtos");

        const produtos = await resposta.json();

        const tabela = document.getElementById("tabelaProdutos");

        tabela.innerHTML = "";

        produtos.forEach(produto => {

            tabela.innerHTML += `

                <tr>

                    <td>${produto.titulo}</td>

                    <td>${produto.marketplace}</td>

                    <td>${produto.categoria}</td>

                    <td>R$ ${produto.preco}</td>

                    <td>${produto.ativo ? "🟢 Ativo" : "🔴 Inativo"}</td>

                    <td>

                        <button onclick="editarProduto(${produto.id})">
                            ✏️ Editar
                        </button>

                        <button onclick="alterarStatus(${produto.id})">
                            ${produto.ativo ? "⛔ Desativar" : "✅ Ativar"}
                        </button>

                        <button onclick="excluirProduto(${produto.id})">
                            🗑️ Excluir
                        </button>

                    </td>

                </tr>

            `;

        });

    } catch (erro) {

        console.error("Erro ao carregar produtos:", erro);

    }

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

carregarProdutos();