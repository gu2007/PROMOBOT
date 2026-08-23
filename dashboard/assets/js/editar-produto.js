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
        document.getElementById("imagem").value = produto.imagem || "";

        inicializarCamposExpandiveis();
        atualizarPratinhaImagem();

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
        linkOriginal: document.getElementById("linkOriginal").value,
        imagem: document.getElementById("imagem").value || null
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

            const mensagem = document.getElementById("mensagem");
            mensagem.className = "mensagemFormulario erro";
            mensagem.textContent = resultado.mensagem;

        }

    } catch (erro) {

        console.error("Erro ao salvar produto:", erro);

    }

}

// ======================================
// Mostra uma pré-visualização da imagem colada, pra confirmar visualmente
// que o link é mesmo de uma foto válida antes de salvar.
// ======================================
function atualizarPratinhaImagem() {

    const url = document.getElementById("imagem").value.trim();
    const pratinha = document.getElementById("pratinhaImagem");
    const foto = document.getElementById("pratinhaImagemFoto");

    if (!url) {
        pratinha.style.display = "none";
        return;
    }

    foto.src = url;
    pratinha.style.display = "flex";

}

document
    .getElementById("salvar")
    .addEventListener("click", salvarProduto);

document
    .getElementById("imagem")
    .addEventListener("input", atualizarPratinhaImagem);

carregarProduto();