async function carregarConfiguracoes() {

    try {

        const resposta = await fetch("/api/config");

        const config = await resposta.json();

        document.getElementById("nicho").value = config.nicho;

        document.getElementById("horarioInicio").value = config.horarioInicio;

        document.getElementById("horarioFim").value = config.horarioFim;

        document.getElementById("produtosPorHora").value = config.produtosPorHora;

        document.getElementById("intervaloRepeticaoHoras").value = config.intervaloRepeticaoHoras;

    } catch (erro) {

        console.error("Erro ao carregar configurações:", erro);

    }

}

async function salvarConfiguracoes() {

    const dados = {

        nicho: document.getElementById("nicho").value,

        horarioInicio: document.getElementById("horarioInicio").value,

        horarioFim: document.getElementById("horarioFim").value,

        produtosPorHora: document.getElementById("produtosPorHora").value,

        intervaloRepeticaoHoras: document.getElementById("intervaloRepeticaoHoras").value

    };

    try {

        const resposta = await fetch("/api/config", {

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

            mensagem.textContent = "Configurações salvas com sucesso!";

        } else {

            mensagem.style.color = "red";

            mensagem.textContent = resultado.mensagem;

        }

    } catch (erro) {

        console.error(erro);

    }

}

document
    .getElementById("salvar")
    .addEventListener("click", salvarConfiguracoes);

carregarConfiguracoes();