let todosOsProdutos = [];
let abaAtiva = "todos";

// ======================================
// Normaliza o nome do marketplace (mesma lógica usada na dashboard), pra
// agrupar variações de maiúscula/espaço sob a mesma aba.
// ======================================
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

// ======================================
// Monta a barra de abas (Todos + uma por marketplace encontrado), com a
// contagem de produtos de cada uma.
// ======================================
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
    renderizarAbas();
    renderizarGrade();

}

// ======================================
// Filtra pela aba ativa + termo de busca, e desenha a grade de cartões.
// ======================================
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
    botaoProximo.setAttribute("aria-label", "Ver mais produtos");
    botaoProximo.textContent = "›";

    botaoAnterior.addEventListener("click", () => {
        carrossel.scrollBy({ left: -carrossel.clientWidth * 0.9, behavior: "smooth" });
    });

    botaoProximo.addEventListener("click", () => {
        carrossel.scrollBy({ left: carrossel.clientWidth * 0.9, behavior: "smooth" });
    });

    produtosFiltrados.forEach(produto => {

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
                <p class="precoProduto">R$ ${produto.preco}</p>
                <div>${badges}</div>
                <div class="acoesProduto">
                    <button onclick="alterarStatus(${produto.id})">${produto.ativo ? "Desativar" : "Ativar"}</button>
                </div>
            </div>
        `;

        carrossel.appendChild(cartao);

    });

    wrapper.appendChild(botaoAnterior);
    wrapper.appendChild(carrossel);
    wrapper.appendChild(botaoProximo);

    container.appendChild(wrapper);

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

document.getElementById("filtroBusca").addEventListener("input", renderizarGrade);

carregarProdutos();