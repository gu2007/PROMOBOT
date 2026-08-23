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

    const grade = document.createElement("div");
    grade.className = "gradeProdutos";

    produtosFiltrados.forEach(produto => {

        const linkSuspeito = !produto.linkAfiliado || produto.linkAfiliado === "LINK_NAO_CONFIRMADO" || !produto.linkAfiliado.startsWith("http");

        const cartao = document.createElement("div");
        cartao.className = "cartaoProduto";

        const imagemHtml = produto.imagem
            ? `<img src="${produto.imagem}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<span class=&quot;placeholderImagem&quot;>Sem foto</span>'">`
            : `<span class="placeholderImagem">Sem foto</span>`;

        let badges = `<span class="badge ${produto.ativo ? "badge-sucesso" : "badge-neutro"}">${produto.ativo ? "Ativo" : "Inativo"}</span>`;

        if (linkSuspeito) {
            badges += ` <span class="badge badge-aviso">Link a confirmar</span>`;
        }

        cartao.innerHTML = `
            <div class="imagemProduto">${imagemHtml}</div>
            <div class="corpoProduto">
                <p class="idProduto">ID: ${produto.id}</p>
                <p class="tituloProduto">${produto.titulo}</p>
                <p class="precoProduto">R$ ${produto.preco}</p>
                <div>${badges}</div>
                <div class="acoesProduto">
                    <button onclick="editarProduto(${produto.id})">Editar</button>
                    <button onclick="alterarStatus(${produto.id})">${produto.ativo ? "Desativar" : "Ativar"}</button>
                    <button onclick="excluirProduto(${produto.id})">Excluir</button>
                </div>
            </div>
        `;

        grade.appendChild(cartao);

    });

    container.appendChild(grade);

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