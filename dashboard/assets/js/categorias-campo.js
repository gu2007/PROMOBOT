/* =====================================================================
   categorias-campo.js — campo "Categoria" do Novo e do Editar produto
   ---------------------------------------------------------------------
   Problema que resolve: antes a categoria era texto livre e cada um
   digitava de um jeito ("Ferramentas", "ferramentas", "Ferramenta
   automotiva"...), criando categorias repetidas.

   O que este arquivo faz:
     1. Busca as categorias que já existem:
          - primeiro tenta /api/categorias (rota do back-end);
          - se não existir, monta a lista a partir de /api/produtos.
     2. Mostra as categorias como chips embaixo do campo. Tocar no chip
        preenche o campo.
     3. Ao sair do campo, se você digitou uma categoria que já existe com
        outra escrita (ex.: "FERRAMENTAS"), troca pela escrita certa.
     4. Se for uma categoria nova, mostra um aviso.

   O campo continua sendo <input id="categoria">, então o novo-produto.js
   e o editar-produto.js funcionam sem mudança (usam .value).
   ===================================================================== */

let categoriasExistentes = [];   // [{ nome: "Ferramentas", total: 120 }]

// Deixa o texto "comparável": minúsculo, sem acento e sem espaços sobrando
function normalizarTexto(texto) {

    return String(texto || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")   // tira acentos
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");

}

async function carregarCategorias() {

    // 1ª tentativa: rota própria do back-end
    try {

        const resposta = await fetch("/api/categorias");

        if (resposta.ok) {
            const lista = await resposta.json();
            if (Array.isArray(lista)) {
                categoriasExistentes = lista
                    .map(item => (typeof item === "string" ? { nome: item, total: 0 } : item))
                    .filter(item => item.nome);
                return;
            }
        }

    } catch (erro) {
        // segue para o plano B
    }

    // Plano B: conta as categorias dos produtos
    try {

        const resposta = await fetch("/api/produtos");
        const produtos = await resposta.json();
        const contagem = {};

        produtos.forEach(produto => {
            const nome = (produto.categoria || "").trim();
            if (nome) contagem[nome] = (contagem[nome] || 0) + 1;
        });

        categoriasExistentes = Object.entries(contagem)
            .map(([nome, total]) => ({ nome, total }))
            .sort((a, b) => b.total - a.total);

    } catch (erro) {

        console.error("Erro ao carregar categorias:", erro);

    }

}

// Procura uma categoria existente igual ao texto (ignorando maiúscula/acento)
function categoriaIgual(texto) {

    const alvo = normalizarTexto(texto);

    return categoriasExistentes.find(c => normalizarTexto(c.nome) === alvo);

}

function desenharSugestoes() {

    const campo = document.getElementById("categoria");
    const caixa = document.getElementById("sugestoesCategoria");

    if (!campo || !caixa) return;

    const atual = normalizarTexto(campo.value);

    caixa.innerHTML = categoriasExistentes.map(categoria => `
        <button type="button"
                class="chip ${normalizarTexto(categoria.nome) === atual ? "ativo" : ""}"
                data-categoria="${escaparHtml(categoria.nome)}">
            ${escaparHtml(categoria.nome)}
        </button>
    `).join("");

    // Aviso de categoria nova
    const dica = document.getElementById("dicaCategoria");

    if (dica) {
        const ehNova = campo.value.trim() && !categoriaIgual(campo.value);
        dica.textContent = ehNova
            ? `"${campo.value.trim()}" é uma categoria nova. Confira se não existe uma parecida acima.`
            : "Escolha uma das categorias existentes para não criar repetidas.";
        dica.style.color = ehNova ? "var(--aviso-texto)" : "";
    }

}

function iniciarCampoCategoria() {

    const campo = document.getElementById("categoria");
    const caixa = document.getElementById("sugestoesCategoria");

    if (!campo || !caixa) return;

    // Tocar num chip preenche o campo
    caixa.addEventListener("click", evento => {
        const chip = evento.target.closest("[data-categoria]");
        if (!chip) return;
        campo.value = chip.dataset.categoria;
        desenharSugestoes();
    });

    campo.addEventListener("input", desenharSugestoes);

    // Ao sair do campo, corrige a escrita se já existir
    campo.addEventListener("blur", () => {
        const existente = categoriaIgual(campo.value);
        if (existente) campo.value = existente.nome;
        desenharSugestoes();
    });

    // A tela Editar preenche o campo sozinha depois de carregar o produto.
    // Isso não dispara "input", então conferimos de tempos em tempos se o
    // valor mudou, para marcar o chip certo.
    let ultimoValor = campo.value;
    setInterval(() => {
        if (campo.value !== ultimoValor) {
            ultimoValor = campo.value;
            desenharSugestoes();
        }
    }, 400);

}

carregarCategorias().then(() => {
    iniciarCampoCategoria();
    desenharSugestoes();
});
