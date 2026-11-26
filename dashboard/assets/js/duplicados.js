/* =====================================================================
   duplicados.js — tela DUPLICADOS
   ---------------------------------------------------------------------
   Um produto "suspeito" tem duplicataSuspeita = true e duplicataDeId =
   id do produto que ele parece repetir (o "já cadastrado").

   Para cada par mostramos os DOIS lado a lado (foto, preço, link) e você
   escolhe:
     - Apagar o novo         -> DELETE no suspeito
     - Apagar o já cadastrado -> DELETE no antigo + o novo deixa de ser
                                suspeito e volta a ficar ativo
     - Não são iguais        -> o novo deixa de ser suspeito e é ativado

   Rotas usadas (já existiam):
     GET    /api/produtos
     PUT    /api/produtos/:id
     DELETE /api/produtos/:id

   Funções do menu.js: icone, escaparHtml, formatarPreco, mostrarAviso.
   ===================================================================== */

let todosOsProdutos = [];

/* ---------- Carregar ---------- */
async function carregarDuplicados() {

    try {

        const resposta = await fetch("/api/produtos");
        todosOsProdutos = await resposta.json();

        renderizarDuplicados();

    } catch (erro) {

        console.error("Erro ao carregar produtos:", erro);
        document.getElementById("listaDuplicados").innerHTML = `
            <div class="estadoVazio">
                <strong>Não foi possível carregar</strong>
                Confira sua internet e tente de novo.
                <br><button onclick="carregarDuplicados()">Tentar de novo</button>
            </div>
        `;

    }

}

/* ---------- Ajudantes ---------- */

// Link para abrir o produto no site (prefere o link original da loja)
function linkDoSite(produto) {

    const link = produto.linkOriginal || produto.linkAfiliado;

    return link && String(link).startsWith("http") ? link : null;

}

// Data no formato "25/11/2026" (aceita ISO ou timestamp)
function formatarData(valor) {

    if (!valor) return null;

    const data = new Date(valor);

    return isNaN(data) ? null : data.toLocaleDateString("pt-BR");

}

// HTML do lado de UM produto no par
function htmlLado(produto, rotulo, lado) {

    const site = linkDoSite(produto);
    const afiliado = produto.linkAfiliado && String(produto.linkAfiliado).startsWith("http") ? produto.linkAfiliado : null;
    const data = formatarData(produto.criadoEm || produto.dataCadastro);

    return `
        <article class="ladoPar">
            <p class="rotuloLado ${lado === "novo" ? "novo" : ""}">${rotulo}</p>

            <div class="fotoOferta">
                ${produto.imagem
                    ? `<img src="${escaparHtml(produto.imagem)}" alt="Foto: ${escaparHtml(produto.titulo)}" loading="lazy" onerror="this.remove()">`
                    : "Sem foto"}
            </div>

            <h3 class="tituloLado">${escaparHtml(produto.titulo)}</h3>
            <span class="precoAtual">${formatarPreco(produto.preco)}</span>

            <div class="metaProduto">
                <span class="etiqueta ${produto.ativo ? "ok" : "neutra"}">${produto.ativo ? "Ativo" : "Pausado"}</span>
                <span class="etiqueta neutra">${escaparHtml(produto.categoria || "Sem categoria")}</span>
                <span class="etiqueta neutra">${escaparHtml(produto.marketplace || "Loja?")}</span>
            </div>

            <p class="infoLado">ID ${produto.id}${data ? ` · cadastrado em ${data}` : ""}</p>

            <div class="linksLado">
                ${site
                    ? `<a href="${escaparHtml(site)}" target="_blank" rel="noopener" class="botao pequeno">${icone("externo")} Abrir no site</a>`
                    : `<span class="infoLado">Sem link da loja</span>`}
                ${afiliado
                    ? `<button class="pequeno fantasma" data-copiar="${escaparHtml(afiliado)}">${icone("copiar")} Copiar link</button>`
                    : ""}
            </div>

            <button class="perigo largo" onclick="apagarProduto(${produto.id}, '${lado}')">
                ${icone("lixeira")} Apagar este
            </button>
        </article>
    `;

}

/* ---------- Desenhar a lista ---------- */
function renderizarDuplicados() {

    const container = document.getElementById("listaDuplicados");
    const resumo = document.getElementById("resumoDuplicados");

    const suspeitos = todosOsProdutos.filter(produto => produto.duplicataSuspeita);

    if (suspeitos.length === 0) {
        resumo.textContent = "";
        container.innerHTML = `
            <div class="estadoVazio">
                <span class="quadradoIcone ok" style="margin:0 auto 12px;">${icone("check")}</span>
                <strong>Nenhum duplicado para revisar</strong>
                Quando o coletor encontrar um produto parecido com outro, ele aparece aqui.
            </div>
        `;
        return;
    }

    resumo.textContent = `${suspeitos.length} ${suspeitos.length === 1 ? "par para revisar" : "pares para revisar"}`;

    container.innerHTML = suspeitos.map(suspeito => {

        const original = todosOsProdutos.find(p => p.id === suspeito.duplicataDeId);

        // Lado do produto já cadastrado (pode ter sido apagado antes)
        const ladoOriginal = original
            ? htmlLado(original, "Já cadastrado", "original")
            : `
                <article class="ladoPar ladoVazio">
                    <p class="rotuloLado">Já cadastrado</p>
                    <p>O outro produto não existe mais (já foi apagado).</p>
                </article>
            `;

        return `
            <section class="cartaoPar" id="par-${suspeito.id}">
                <div class="ladosPar">
                    ${htmlLado(suspeito, "Novo (importado)", "novo")}
                    ${ladoOriginal}
                </div>
                <div class="rodapePar">
                    <button onclick="naoEhDuplicata(${suspeito.id})">
                        ${icone("check")} ${original ? "Não são iguais, manter os dois" : "Manter o novo"}
                    </button>
                    <a href="/editar-produto?id=${suspeito.id}" class="botao fantasma">${icone("editar")} Editar o novo</a>
                </div>
            </section>
        `;

    }).join("");

}

/* ---------- Ações ---------- */

// Tira a marca de "suspeito" do produto e deixa ele ativo
async function liberarProduto(id) {

    const resposta = await fetch(`/api/produtos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicataSuspeita: false, duplicataDeId: null, ativo: true })
    });

    const resultado = await resposta.json();

    if (!resultado.sucesso) throw new Error(resultado.mensagem || "falhou");

}

async function naoEhDuplicata(id) {

    try {

        await liberarProduto(id);
        mostrarAviso("Mantidos os dois. O novo foi ativado.");
        carregarDuplicados();

    } catch (erro) {

        console.error("Erro ao atualizar produto:", erro);
        mostrarAviso("Não deu certo. Tente de novo.", "erro");

    }

}

// lado = "novo" (o suspeito) ou "original" (o já cadastrado)
async function apagarProduto(id, lado) {

    const produto = todosOsProdutos.find(p => p.id === id);

    // Se for o já cadastrado, descobre quais "novos" apontam para ele
    const suspeitos = lado === "original"
        ? todosOsProdutos.filter(p => p.duplicataSuspeita && p.duplicataDeId === id)
        : [];

    const mensagem = lado === "original"
        ? `Apagar o produto JÁ CADASTRADO (ID ${id})?\n\n"${produto.titulo}"\n\nO produto novo fica no lugar dele e volta a ser divulgado.\nIsso não pode ser desfeito.`
        : `Apagar o produto NOVO (ID ${id})?\n\n"${produto.titulo}"\n\nO já cadastrado continua como está.\nIsso não pode ser desfeito.`;

    if (!confirm(mensagem)) return;

    try {

        const resposta = await fetch(`/api/produtos/${id}`, { method: "DELETE" });
        const resultado = await resposta.json();

        if (!resultado.sucesso) throw new Error(resultado.mensagem || "falhou");

        // Apagou o antigo: o novo deixa de ser suspeito e é ativado
        for (const novo of suspeitos) {
            await liberarProduto(novo.id);
        }

        mostrarAviso(lado === "original" ? "Antigo apagado. O novo ficou no lugar." : "Produto novo apagado.");
        carregarDuplicados();

    } catch (erro) {

        console.error("Erro ao apagar produto:", erro);
        mostrarAviso("Não foi possível apagar.", "erro");

    }

}

async function copiarTexto(texto) {

    try {
        await navigator.clipboard.writeText(texto);
        mostrarAviso("Link copiado");
    } catch (erro) {
        window.prompt("Copie o link:", texto);
    }

}

// Botões "Copiar link": o link fica no atributo data-copiar
document.addEventListener("click", evento => {
    const botao = evento.target.closest("[data-copiar]");
    if (botao) copiarTexto(botao.dataset.copiar);
});

carregarDuplicados();
