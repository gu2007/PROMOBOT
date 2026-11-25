/* =====================================================================
   app.js — tela INÍCIO
   ---------------------------------------------------------------------
   Busca 3 coisas no servidor:
     /api/dashboard      -> horário, produtos por hora, nicho
     /api/config/status  -> robô ligado ou pausado
     /api/produtos       -> lista de produtos (para contar tudo aqui no
                            navegador: ativas, pausadas, pendências...)
   Usa funções do menu.js: icone(), escaparHtml(), mostrarAviso().
   ===================================================================== */

let configDashboard = {};   // dados de /api/dashboard
let sistemaAtivo = false;   // robô ligado?

/* ---------- Saudação ("Bom dia", "Boa tarde", "Boa noite") ---------- */
function montarSaudacao() {

    const hora = new Date().getHours();
    let texto = "Boa noite";

    if (hora >= 5 && hora < 12) texto = "Bom dia";
    else if (hora >= 12 && hora < 18) texto = "Boa tarde";

    document.getElementById("saudacao").textContent = texto;

}

/* ---------- Mesmas regras que a tela de Ofertas usa ---------- */

// Link de afiliado faltando ou inválido
function linkSuspeito(produto) {

    const link = produto.linkAfiliado;

    return !link || link === "LINK_NAO_CONFIRMADO" || !String(link).startsWith("http");

}

// A data de "hoje" (sem horário) para comparar
function ehHoje(valorData) {

    if (!valorData) return false;

    const data = new Date(valorData);

    if (isNaN(data)) return false;

    return data.toDateString() === new Date().toDateString();

}

/* ---------- Cartão do robô ---------- */
async function carregarRobo() {

    try {

        const [respostaDash, respostaStatus] = await Promise.all([
            fetch("/api/dashboard"),
            fetch("/api/config/status")
        ]);

        configDashboard = await respostaDash.json();
        const status = await respostaStatus.json();

        sistemaAtivo = !!status.sistemaAtivo;

        desenharRobo();

    } catch (erro) {

        console.error("Erro ao carregar o robô:", erro);
        document.getElementById("fraseRobo").textContent = "Não foi possível falar com o servidor";

    }

}

function desenharRobo() {

    const inicio = Number(configDashboard.horarioInicio);
    const fim = Number(configDashboard.horarioFim);
    const porHora = configDashboard.produtosPorHora;
    const horaAgora = new Date().getHours();

    const dentroDoHorario = horaAgora >= inicio && horaAgora < fim;

    const pilula = document.getElementById("pilulaRobo");
    const frase = document.getElementById("fraseRobo");
    const detalhe = document.getElementById("detalheRobo");
    const botao = document.getElementById("btnSistema");

    if (!sistemaAtivo) {

        pilula.textContent = "Pausado";
        pilula.className = "pilulaStatus pausado";
        frase.textContent = "O robô está pausado";
        botao.innerHTML = `${icone("play")} Ligar robô`;

    } else if (dentroDoHorario) {

        pilula.textContent = "Postando";
        pilula.className = "pilulaStatus";
        frase.textContent = `Postando até as ${fim}h`;
        botao.innerHTML = `${icone("pausar")} Pausar`;

    } else {

        pilula.textContent = "Fora do horário";
        pilula.className = "pilulaStatus pausado";
        frase.textContent = `Volta a postar às ${inicio}h`;
        botao.innerHTML = `${icone("pausar")} Pausar`;

    }

    detalhe.textContent = `${porHora} por hora · das ${inicio}h às ${fim}h`;

}

// Liga ou pausa o robô
async function alternarRobo() {

    const botao = document.getElementById("btnSistema");
    botao.disabled = true;

    try {

        await fetch("/api/config/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sistemaAtivo: !sistemaAtivo })
        });

        sistemaAtivo = !sistemaAtivo;
        desenharRobo();
        atualizarStatusTopo();   // função do menu.js (pílula no PC)
        mostrarAviso(sistemaAtivo ? "Robô ligado" : "Robô pausado");

    } catch (erro) {

        mostrarAviso("Não deu certo. Tente de novo.", "erro");

    }

    botao.disabled = false;

}

/* ---------- Números, atenção, categorias, últimas ---------- */
async function carregarProdutos() {

    try {

        const resposta = await fetch("/api/produtos");
        const produtos = await resposta.json();

        desenharNumeros(produtos);
        desenharAtencao(produtos);
        desenharCategorias(produtos);
        desenharUltimas(produtos);

    } catch (erro) {

        console.error("Erro ao carregar produtos:", erro);

    }

}

function desenharNumeros(produtos) {

    const ativas = produtos.filter(p => p.ativo).length;
    const categorias = new Set(produtos.map(p => (p.categoria || "").trim()).filter(Boolean));
    const hoje = produtos.filter(p => ehHoje(p.ultimaDivulgacao)).length;

    document.getElementById("numAtivas").textContent = ativas;
    document.getElementById("numPausadas").textContent = produtos.length - ativas;
    document.getElementById("numHoje").textContent = hoje;
    document.getElementById("numCategorias").textContent = categorias.size;

}

function desenharAtencao(produtos) {

    const alteracoes = produtos.filter(p => p.alteracaoDetectada).length;
    const duplicados = produtos.filter(p => p.duplicataSuspeita).length;
    const semLink = produtos.filter(p => p.ativo && linkSuspeito(p)).length;

    // Cada pendência vira uma linha clicável. Só mostra as que têm algo.
    const itens = [
        { qtd: alteracoes, href: "/alteracoes", cor: "aviso", icone: "alteracoes",
          titulo: n => `${n} ${n === 1 ? "mudança de preço" : "mudanças de preço"}`, dica: "Confirmar ou ignorar" },
        { qtd: duplicados, href: "/duplicados", cor: "perigo", icone: "duplicados",
          titulo: n => `${n} ${n === 1 ? "possível duplicado" : "possíveis duplicados"}`, dica: "Manter ou apagar" },
        { qtd: semLink, href: "/produtos?filtro=semlink", cor: "info", icone: "link",
          titulo: n => `${n} ${n === 1 ? "oferta ativa" : "ofertas ativas"} sem link de afiliado`, dica: "Completar o link" }
    ].filter(item => item.qtd > 0);

    const lista = document.getElementById("listaAtencao");

    if (itens.length === 0) {
        lista.innerHTML = `
            <div class="tudoEmDia">
                <span class="quadradoIcone ok">${icone("check")}</span>
                Tudo em dia. Nada para revisar agora.
            </div>
        `;
        return;
    }

    lista.innerHTML = itens.map(item => `
        <a href="${item.href}">
            <span class="quadradoIcone ${item.cor}">${icone(item.icone)}</span>
            <span class="textoItem">${item.titulo(item.qtd)}<small>${item.dica}</small></span>
            <span class="seta">${icone("seta")}</span>
        </a>
    `).join("");

}

function desenharCategorias(produtos) {

    // Conta quantas ofertas ATIVAS existem em cada categoria
    const contagem = {};

    produtos.forEach(produto => {
        const categoria = (produto.categoria || "Sem categoria").trim();
        if (!contagem[categoria]) contagem[categoria] = { total: 0, ativas: 0 };
        contagem[categoria].total++;
        if (produto.ativo) contagem[categoria].ativas++;
    });

    const categorias = Object.entries(contagem)
        .sort((a, b) => b[1].ativas - a[1].ativas)
        .slice(0, 6);   // mostra as 6 maiores

    const maior = Math.max(1, ...categorias.map(([, c]) => c.ativas));
    const lista = document.getElementById("listaCategorias");

    if (categorias.length === 0) {
        lista.innerHTML = `<p class="estadoVazio">Nenhuma oferta cadastrada ainda.</p>`;
        return;
    }

    lista.innerHTML = categorias.map(([nome, c]) => `
        <a class="linhaCategoria" href="/produtos?categoria=${encodeURIComponent(nome)}">
            <span class="rotuloCategoria">
                <span>${escaparHtml(nome)}</span>
                <span>${c.ativas} ativas de ${c.total}</span>
            </span>
            <span class="barraCategoria"><div style="width:${Math.round((c.ativas / maior) * 100)}%"></div></span>
        </a>
    `).join("");

}

function desenharUltimas(produtos) {

    const fileira = document.getElementById("ultimasPostadas");

    // Só produtos com data válida de divulgação, do mais novo pro mais velho
    const postadas = produtos
        .filter(p => p.ultimaDivulgacao && !isNaN(new Date(p.ultimaDivulgacao)))
        .sort((a, b) => new Date(b.ultimaDivulgacao) - new Date(a.ultimaDivulgacao))
        .slice(0, 10);

    if (postadas.length === 0) {
        fileira.innerHTML = `<p class="subtitulo">Nenhuma oferta postada ainda.</p>`;
        return;
    }

    fileira.innerHTML = postadas.map(produto => {

        const data = new Date(produto.ultimaDivulgacao);
        const quando = ehHoje(data)
            ? `hoje, ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
            : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

        const foto = produto.imagem
            ? `<img src="${escaparHtml(produto.imagem)}" alt="" loading="lazy">`
            : "";

        return `
            <a class="mini" href="/produtos?abrir=${produto.id}">
                <div class="fotoMini">${foto}</div>
                <p>${escaparHtml(produto.titulo)}</p>
                <small>${quando}</small>
            </a>
        `;

    }).join("");

}

/* ---------- Começo ---------- */
document.getElementById("btnSistema").addEventListener("click", alternarRobo);

montarSaudacao();
carregarRobo();
carregarProdutos();

// Atualiza o cartão do robô a cada 30 segundos
setInterval(carregarRobo, 30000);
