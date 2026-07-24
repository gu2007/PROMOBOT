async function cadastrarProduto() {

    const dados = {

        marketplace: document.getElementById("marketplace").value,

        categoria: document.getElementById("categoria").value,

        titulo: document.getElementById("titulo").value,

        preco: Number(document.getElementById("preco").value),

        precoAntigo: Number(document.getElementById("precoAntigo").value),

        linkAfiliado: document.getElementById("linkAfiliado").value,

        linkOriginal: document.getElementById("linkOriginal").value

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

            mensagem.style.color = "green";
            mensagem.textContent = "Produto cadastrado com sucesso!";

            document.getElementById("categoria").value = "";
            document.getElementById("titulo").value = "";
            document.getElementById("preco").value = "";
            document.getElementById("precoAntigo").value = "";
            document.getElementById("linkAfiliado").value = "";
            document.getElementById("linkOriginal").value = "";

        } else {

            mensagem.style.color = "red";
            mensagem.textContent = resultado.mensagem;

        }

    } catch (erro) {

        console.error(erro);

    }

}

document
    .getElementById("cadastrar")
    .addEventListener("click", cadastrarProduto);