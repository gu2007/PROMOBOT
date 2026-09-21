async function cadastrarProduto() {

    const dados = {
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

        const resposta = await fetch("/api/produtos", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(dados)
        });

        const resultado = await resposta.json();
        const mensagem = document.getElementById("mensagem");

        if (resultado.sucesso) {

            mensagem.className = "mensagemFormulario sucesso";
            mensagem.textContent = "Produto cadastrado.";

            document.getElementById("categoria").value = "";
            document.getElementById("titulo").value = "";
            document.getElementById("preco").value = "";
            document.getElementById("precoAntigo").value = "";
            document.getElementById("linkAfiliado").value = "";
            document.getElementById("linkOriginal").value = "";
            document.getElementById("imagem").value = "";
            document.getElementById("pratinhaImagem").style.display = "none";

            inicializarCamposExpandiveis();

        } else {

            mensagem.className = "mensagemFormulario erro";
            mensagem.textContent = resultado.mensagem;

        }

    } catch (erro) {

        console.error(erro);

    }

}

// Mostra uma pré-visualização da imagem colada, pra confirmar visualmente
// que o link é mesmo de uma foto válida antes de salvar.
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
    .getElementById("cadastrar")
    .addEventListener("click", cadastrarProduto);

document
    .getElementById("imagem")
    .addEventListener("input", atualizarPratinhaImagem);
