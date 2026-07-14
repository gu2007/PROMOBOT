async function carregarDashboard() {

    try {

        // Dashboard
        const respostaDashboard = await fetch("/api/dashboard");
        const dados = await respostaDashboard.json();

        document.getElementById("produtos").textContent = dados.produtos;
        document.getElementById("ativos").textContent = dados.ativos;
        document.getElementById("categorias").textContent = dados.categorias;
        document.getElementById("status").textContent = "🟢 " + dados.status;

        document.getElementById("nicho").textContent = dados.nicho;

        document.getElementById("horario").textContent =
            `${dados.horarioInicio}h às ${dados.horarioFim}h`;

        document.getElementById("produtosHora").textContent =
            dados.produtosPorHora;

        // Status do sistema
        const respostaStatus = await fetch("/api/config/status");

        const statusSistema = await respostaStatus.json();

        const textoStatus = document.getElementById("statusSistema");
        const botao = document.getElementById("btnSistema");

        if (statusSistema.sistemaAtivo) {

            textoStatus.textContent = "🟢 PROMOBOT ONLINE";

            botao.textContent = "⏸️ Pausar Sistema";

        } else {

            textoStatus.textContent = "🔴 PROMOBOT OFFLINE";

            botao.textContent = "▶️ Iniciar Sistema";

        }

    } catch (erro) {

        console.error("Erro ao carregar Dashboard:", erro);

    }

}

async function alterarStatusSistema() {

    try {

        const resposta = await fetch("/api/config/status");

        const statusAtual = await resposta.json();

        await fetch("/api/config/status", {

            method: "PATCH",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify({

                sistemaAtivo: !statusAtual.sistemaAtivo

            })

        });

        carregarDashboard();

    } catch (erro) {

        console.error("Erro ao alterar status:", erro);

    }

}

document
    .getElementById("btnSistema")
    .addEventListener("click", alterarStatusSistema);

// Atualiza ao abrir
carregarDashboard();

// Atualiza automaticamente a cada 30 segundos
setInterval(carregarDashboard, 30000);