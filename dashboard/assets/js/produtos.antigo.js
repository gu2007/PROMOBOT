let todosOsProdutos = [];
let abaAtiva = "todos";
let paginaAtual = 0;

const PRODUTOS_POR_LINHA = 20;
const LINHAS_POR_PAGINA = 12;

// Normaliza o nome do marketplace (mesma lógica usada na dashboard), pra
// agrupar variações de maiúscula/espaço sob a mesma aba.
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

async function carregarProdutos() {

    try {

        const resposta = await fetch("/api/produtos");

        todosOsProdutos = await resposta.json();

        renderizarAbas();
        renderizarGrade();

    } catch (erro) {

        console.error("Erro ao carregar produtos:", erro);

    }

}

// Monta a barra de abas (Todos + uma por marketplace encontrado), com a
// contagem de produtos de cada uma.
function renderizarAbas() {

    const contagem = {};

    todosOsProdutos.forEach(produto => {
        const chave = normalizarNomeMarketplace(produto.marketplace);
        contagem[chave] = (contagem[chave] || 0) + 1;
    });

    const chaves = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a]);

    const container = document.getElementById("abasMarketplace");
    container.innerHTML = "";

    const abaTodos = document.createElement("button");
    abaTodos.className = "abaMarketplace" + (abaAtiva === "todos" ? " ativa" : "");
    abaTodos.textContent = `Todos (${todosOsProdutos.length})`;
    abaTodos.addEventListener("click", () => selecionarAba("todos"));
    container.appendChild(abaTodos);

    chaves.forEach(chave => {

        const botao = document.createElement("button");
        botao.className = "abaMarketplace" + (abaAtiva === chave ? " ativa" : "");
        botao.textContent = `${rotuloMarketplace(chave)} (${contagem[chave]})`;
        botao.addEventListener("click", () => selecionarAba(chave));
        container.appendChild(botao);

    });

}

function selecionarAba(chave) {

    abaAtiva = chave;
    paginaAtual = 0;
    renderizarAbas();
    renderizarGrade();

}

// Divide uma lista em grupos menores (ex: 47 produtos, grupos de 20 ->
// [20, 20, 7]). Cada grupo vira uma linha própria com seu próprio carrossel.
function dividirEmGrupos(lista, tamanho) {

    const grupos = [];

    for (let i = 0; i < lista.length; i += tamanho) {
        grupos.push(lista.slice(i, i + tamanho));
    }

    return grupos;

}

// Monta o HTML de um único cartão de produto (usado dentro de cada linha).
function montarCartaoProduto(produto) {

    const linkSuspeito = !produto.linkAfiliado || produto.linkAfiliado === "LINK_NAO_CONFIRMADO" || !produto.linkAfiliado.startsWith("http");

    const cartao = document.createElement("div");
    cartao.className = "cartaoProdutoPequeno";

    const imagemHtml = produto.imagem
        ? `<img src="${produto.imagem}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<span class=&quot;placeholderImagem&quot;>Sem foto</span>'">`
        : `<span class="placeholderImagem">Sem foto</span>`;

    let badges = `<span class="badge ${produto.ativo ? "badge-sucesso" : "badge-perigo"}">${produto.ativo ? "Ativo" : "Inativo"}</span>`;

    if (linkSuspeito) {
        badges += ` <span class="badge badge-aviso">Link a confirmar</span>`;
    }

    const temDescontoReal = produto.precoAntigo && Number(produto.precoAntigo) > Number(produto.preco);

    const precoHtml = temDescontoReal
        ? `<s style="color:var(--cor-texto-terciario); font-size:12px; font-weight:400;">R$ ${produto.precoAntigo}</s> R$ ${produto.preco}`
        : `R$ ${produto.preco}`;

    cartao.innerHTML = `
        <div class="imagemProduto">
            ${imagemHtml}
            <div class="acoesImagemProduto">
                <button class="acaoIconeProduto" onclick="editarProduto(${produto.id})" aria-label="Editar produto" title="Editar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </button>
                <button class="acaoIconeProduto acaoExcluir" onclick="excluirProduto(${produto.id})" aria-label="Excluir produto" title="Excluir">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
            </div>
        </div>
        <div class="corpoProduto">
            <p class="idProduto">ID: ${produto.id}</p>
            <p class="tituloProduto">${produto.titulo}</p>
            <p class="precoProduto">${precoHtml}</p>
            <div>${badges}</div>
            <div class="acoesProduto">
                <button onclick="alterarStatus(${produto.id})">${produto.ativo ? "Desativar" : "Ativar"}</button>
            </div>
        </div>
    `;

    return cartao;

}

// Monta uma linha inteira: setas + carrossel horizontal com os produtos
// desse grupo (até 20). Cada linha rola de lado de forma independente.
function montarLinhaCarrossel(produtosDaLinha) {

    const wrapper = document.createElement("div");
    wrapper.className = "carrosselWrapper";

    const botaoAnterior = document.createElement("button");
    botaoAnterior.className = "botaoCarrossel";
    botaoAnterior.setAttribute("aria-label", "Ver produtos anteriores");
    botaoAnterior.textContent = "‹";

    const carrossel = document.createElement("div");
    carrossel.className = "carrosselProdutos";

    const botaoProximo = document.createElement("button");
    botaoProximo.className = "botaoCarrossel";
    botaoProximo.setAttribute("aria-label", "Ver mais produtos dessa linha");
    botaoProximo.textContent = "›";

    botaoAnterior.addEventListener("click", () => {
        carrossel.scrollBy({ left: -carrossel.clientWidth * 0.9, behavior: "smooth" });
    });

    botaoProximo.addEventListener("click", () => {
        carrossel.scrollBy({ left: carrossel.clientWidth * 0.9, behavior: "smooth" });
    });

    produtosDaLinha.forEach(produto => {
        carrossel.appendChild(montarCartaoProduto(produto));
    });

    wrapper.appendChild(botaoAnterior);
    wrapper.appendChild(carrossel);
    wrapper.appendChild(botaoProximo);

    return wrapper;

}

// Monta a navegação numerada (1, 2, 3... + "Seguinte ›"), usada quando o
// total de linhas passa do limite de uma página.
function montarPaginacao(totalPaginas) {

    const nav = document.createElement("div");
    nav.className = "paginacaoLinhas";

    for (let i = 0; i < totalPaginas; i++) {

        const botao = document.createElement("button");
        botao.className = "botaoPagina" + (i === paginaAtual ? " ativa" : "");
        botao.textContent = i + 1;
        botao.addEventListener("click", () => {
            paginaAtual = i;
            renderizarGrade();
            window.scrollTo({ top: 0, behavior: "smooth" });
        });

        nav.appendChild(botao);

    }

    if (paginaAtual < totalPaginas - 1) {

        const seguinte = document.createElement("button");
        seguinte.className = "botaoPagina botaoPaginaSeguinte";
        seguinte.textContent = "Seguinte ›";
        seguinte.addEventListener("click", () => {
            paginaAtual++;
            renderizarGrade();
            window.scrollTo({ top: 0, behavior: "smooth" });
        });

        nav.appendChild(seguinte);

    }

    return nav;

}

// Filtra pela aba ativa + termo de busca, divide em linhas de até 20
// produtos, limita a 12 linhas por página (com navegação numerada quando
// precisa de mais páginas), e desenha cada linha com seu próprio carrossel.
function renderizarGrade() {

    const container = document.getElementById("gradeProdutosContainer");
    const termoBusca = document.getElementById("filtroBusca").value.trim().toLowerCase();

    let produtosFiltrados = todosOsProdutos;

    if (abaAtiva !== "todos") {
        produtosFiltrados = produtosFiltrados.filter(
            produto => normalizarNomeMarketplace(produto.marketplace) === abaAtiva
        );
    }

    if (termoBusca) {
        produtosFiltrados = produtosFiltrados.filter(
            produto => produto.titulo.toLowerCase().includes(termoBusca)
        );
    }

    container.innerHTML = "";

    if (produtosFiltrados.length === 0) {
        container.innerHTML = "<p style='color:var(--cor-texto-secundario);'>Nenhum produto encontrado.</p>";
        return;
    }

    const todasAsLinhas = dividirEmGrupos(produtosFiltrados, PRODUTOS_POR_LINHA);
    const totalPaginas = Math.ceil(todasAsLinhas.length / LINHAS_POR_PAGINA);

    if (paginaAtual >= totalPaginas) {
        paginaAtual = totalPaginas - 1;
    }

    if (paginaAtual < 0) {
        paginaAtual = 0;
    }

    const inicioLinha = paginaAtual * LINHAS_POR_PAGINA;
    const linhasDaPagina = todasAsLinhas.slice(inicioLinha, inicioLinha + LINHAS_POR_PAGINA);

    linhasDaPagina.forEach(produtosDaLinha => {
        container.appendChild(montarLinhaCarrossel(produtosDaLinha));
    });

    if (totalPaginas > 1) {
        container.appendChild(montarPaginacao(totalPaginas));
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

document.getElementById("filtroBusca").addEventListener("input", () => {
    paginaAtual = 0;
    renderizarGrade();
});

// Adiciona uma linha colorida na área de log (mesmo padrão visual usado na
// Verificação de Preços e na Importação por IA).
function adicionarLinhaLogResolucao(texto, tipo) {

    const area = document.getElementById("areaResolucao");
    const linha = document.createElement("div");
    linha.className = `linhaLog linhaLog-${tipo || "info"}`;
    linha.textContent = texto;
    area.appendChild(linha);
    area.scrollTop = area.scrollHeight;

}

// Dispara a resolução automática (link original + imagem) em todos os
// produtos do Mercado Livre e Amazon que ainda estão com algum campo
// faltando — útil pra completar produtos antigos, cadastrados antes dessa
// funcionalidade existir. Mostra o progresso produto por produto, em tempo
// real, via streaming (SSE).
async function resolverPendentes() {

    const botao = document.getElementById("btnResolverPendentes");
    const mensagem = document.getElementById("mensagemResolucao");
    const area = document.getElementById("areaResolucao");

    botao.disabled = true;
    mensagem.className = "mensagemFormulario";
    mensagem.textContent = "";
    area.style.display = "block";
    area.innerHTML = "";

    try {

        const resposta = await fetch("/api/produtos/resolver-pendentes", { method: "POST" });

        if (!resposta.ok || !resposta.body) {
            adicionarLinhaLogResolucao("Erro ao conectar com o servidor.", "erro");
            botao.disabled = false;
            return;
        }

        const leitor = resposta.body.getReader();
        const decodificador = new TextDecoder();
        let bufferTexto = "";

        while (true) {

            const { done, value } = await leitor.read();

            if (done) break;

            bufferTexto += decodificador.decode(value, { stream: true });

            const partes = bufferTexto.split("\n\n");
            bufferTexto = partes.pop();

            for (const parte of partes) {

                const linhaEvento = parte.split("\n").find(l => l.startsWith("event:"));
                const linhaDados = parte.split("\n").find(l => l.startsWith("data:"));

                if (!linhaEvento || !linhaDados) continue;

                const tipo = linhaEvento.replace("event:", "").trim();
                const dados = JSON.parse(linhaDados.replace("data:", "").trim());

                if (tipo === "inicio") {

                    if (dados.total === 0) {
                        adicionarLinhaLogResolucao("Nenhum produto pendente encontrado — todos já têm link original e imagem.", "sucesso");
                    } else {
                        adicionarLinhaLogResolucao(`${dados.total} produto(s) pendente(s) encontrado(s). Isso pode levar alguns minutos...`, "info");
                    }

                }

                if (tipo === "produto") {

                    const texto = `#${dados.produtoId} ${dados.titulo.slice(0, 50)} — ${dados.sucesso ? "resolvido com sucesso" : "não foi possível resolver"}`;
                    adicionarLinhaLogResolucao(texto, dados.sucesso ? "sucesso" : "aviso");

                }

                if (tipo === "final") {

                    adicionarLinhaLogResolucao(`Concluído: ${dados.resolvidos} resolvido(s), ${dados.falhas} não resolvido(s).`, "sucesso");
                    mensagem.className = "mensagemFormulario sucesso";
                    mensagem.textContent = "Resolução concluída — atualizando a lista de produtos...";
                    carregarProdutos();

                }

            }

        }

    } catch (erro) {

        adicionarLinhaLogResolucao(`Erro de conexão: ${erro.message}`, "erro");

    }

    botao.disabled = false;

}

// Corrige de uma vez todos os produtos ativos que não têm desconto real
// (sem preço antigo, ou preço antigo não maior que o atual), desativando
// eles. Não usa IA nenhuma — é só um filtro nos dados que já temos, então é
// instantâneo.
async function corrigirSemDesconto() {

    const botao = document.getElementById("btnCorrigirSemDesconto");
    const mensagem = document.getElementById("mensagemResolucao");

    botao.disabled = true;
    mensagem.className = "mensagemFormulario";
    mensagem.textContent = "Verificando produtos sem desconto real...";

    try {

        const resposta = await fetch("/api/produtos/corrigir-sem-desconto", { method: "POST" });
        const resultado = await resposta.json();

        if (resultado.sucesso) {

            mensagem.className = "mensagemFormulario sucesso";
            mensagem.textContent = resultado.corrigidos > 0
                ? `${resultado.corrigidos} produto(s) sem desconto real foram desativados.`
                : "Nenhum produto sem desconto real encontrado — está tudo certo.";

            carregarProdutos();

        } else {

            mensagem.className = "mensagemFormulario erro";
            mensagem.textContent = resultado.mensagem || "Erro ao corrigir produtos.";

        }

    } catch (erro) {

        mensagem.className = "mensagemFormulario erro";
        mensagem.textContent = `Erro de conexão: ${erro.message}`;

    }

    botao.disabled = false;

}

document
    .getElementById("btnResolverPendentes")
    .addEventListener("click", resolverPendentes);

document
    .getElementById("btnCorrigirSemDesconto")
    .addEventListener("click", corrigirSemDesconto);

carregarProdutos();
