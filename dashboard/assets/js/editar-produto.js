const parametros = new URLSearchParams(window.location.search);

const id = parametros.get("id");

async function carregarProduto() {

    try {

        const resposta = await fetch(`/api/produtos/${id}`);

        const produto = await resposta.json();

        document.getElementById("id").value = produto.id;
        document.getElementById("marketplace").value = produto.marketplace;
        document.getElementById("categoria").value = produto.categoria;
        document.getElementById("titulo").value = produto.titulo;
        document.getElementById("preco").value = produto.preco;
        document.getElementById("precoAntigo").value = produto.precoAntigo;
        document.getElementById("linkAfiliado").value = produto.linkAfiliado;
        document.getElementById("linkOriginal").value = produto.linkOriginal || "";

        const linkOriginalBotao = document.getElementById("linkOriginalBotao");
        const avisoLinkNaoConfirmado = document.getElementById("avisoLinkNaoConfirmado");

        const linkValido = produto.linkAfiliado && produto.linkAfiliado !== "LINK_NAO_CONFIRMADO" && produto.linkAfiliado.startsWith("http");

        if (linkValido) {
            linkOriginalBotao.href = produto.linkAfiliado;
            linkOriginalBotao.style.display = "inline-block";
        }

        if (produto.linkAfiliado === "LINK_NAO_CONFIRMADO") {
            avisoLinkNaoConfirmado.style.display = "block";
        }

    } catch (erro) {

        console.error("Erro ao carregar produto:", erro);

    }

}

async function salvarProduto() {

    const produto = {

        marketplace: document.getElementById("marketplace").value,

        categoria: document.getElementById("categoria").value,

        titulo: document.getElementById("titulo").value,

        preco: Number(document.getElementById("preco").value),

        precoAntigo: Number(document.getElementById("precoAntigo").value),

        linkAfiliado: document.getElementById("linkAfiliado").value,

        linkOriginal: document.getElementById("linkOriginal").value

    };

    try {

        const resposta = await fetch(`/api/produtos/${id}`, {

            method: "PUT",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify(produto)

        });

        const resultado = await resposta.json();

        if (resultado.sucesso) {

            window.location.href = "/produtos";

        } else {

            document.getElementById("mensagem").textContent = resultado.mensagem;

        }

    } catch (erro) {

        console.error("Erro ao salvar produto:", erro);

    }

}

document
    .getElementById("salvar")
    .addEventListener("click", salvarProduto);

carregarProduto();