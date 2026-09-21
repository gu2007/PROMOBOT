async function carregarDashboard() {

    try {

        const respostaDashboard = await fetch("/api/dashboard");
        const dados = await respostaDashboard.json();

        document.getElementById("produtos").textContent = dados.produtos;
        document.getElementById("ativos").textContent = dados.ativos;
        document.getElementById("categorias").textContent = dados.categorias;

        const statusEl = document.getElementById("status");
        statusEl.textContent = dados.status;
        statusEl.className = dados.status === "Online" ? "badge badge-sucesso" : "badge badge-aviso";

        document.getElementById("nicho").textContent = dados.nicho;

        document.getElementById("horario").textContent =
            `${dados.horarioInicio}h às ${dados.horarioFim}h`;

        document.getElementById("produtosHora").textContent = dados.produtosPorHora;

        const respostaStatus = await fetch("/api/config/status");
        const statusSistema = await respostaStatus.json();

        const textoStatus = document.getElementById("statusSistema");
        const botao = document.getElementById("btnSistema");

        if (statusSistema.sistemaAtivo) {
            textoStatus.textContent = "PROMOBOT online";
            botao.textContent = "Pausar sistema";
            botao.className = "";
        } else {
            textoStatus.textContent = "PROMOBOT pausado";
            botao.textContent = "Iniciar sistema";
            botao.className = "primario";
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

// Conta quantos produtos existem em cada marketplace (Mercado Livre, Amazon,
// Shopee) pro gráfico, normalizando o nome pra agrupar variações de
// maiúscula/espaço no mesmo grupo.
function normalizarNomeMarketplace(nome) {

    return (nome || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");

}

function rotuloMarketplace(chaveNormalizada) {

    if (chaveNormalizada === "mercadolivre") return "Mercado Livre";
    if (chaveNormalizada === "amazon") return "Amazon";
    if (chaveNormalizada === "shopee") return "Shopee";

    return chaveNormalizada || "Sem marketplace";

}

function corMarketplace(chaveNormalizada) {

    if (chaveNormalizada === "mercadolivre") return "#2a78d6";
    if (chaveNormalizada === "amazon") return "#eb6834";
    if (chaveNormalizada === "shopee") return "#eda100";

    return "#9CA3AF";

}

async function carregarGraficoMarketplace() {

    try {

        const resposta = await fetch("/api/produtos");
        const produtos = await resposta.json();

        const contagem = {};

        produtos.forEach(produto => {
            const chave = normalizarNomeMarketplace(produto.marketplace);
            contagem[chave] = (contagem[chave] || 0) + 1;
        });

        const chaves = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a]);
        const rotulos = chaves.map(rotuloMarketplace);
        const valores = chaves.map(chave => contagem[chave]);
        const cores = chaves.map(corMarketplace);

        const legenda = document.getElementById("legendaMarketplace");
        legenda.innerHTML = chaves.map((chave, indice) => `
            <span>
                <span class="pontoLegenda" style="background:${cores[indice]}"></span>
                ${rotulos[indice]} (${valores[indice]})
            </span>
        `).join("");

        new Chart(document.getElementById("graficoMarketplace"), {
            type: "bar",
            data: {
                labels: rotulos,
                datasets: [{
                    data: valores,
                    backgroundColor: cores,
                    borderRadius: 4,
                    maxBarThickness: 56
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#E5E7EB" } },
                    x: { grid: { display: false } }
                }
            }
        });

    } catch (erro) {

        console.error("Erro ao carregar gráfico de marketplace:", erro);

    }

}

document
    .getElementById("btnSistema")
    .addEventListener("click", alterarStatusSistema);

carregarDashboard();
carregarGraficoMarketplace();

setInterval(carregarDashboard, 30000);
