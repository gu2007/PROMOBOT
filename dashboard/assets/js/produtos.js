/* =====================================================================
   produtos.js — tela OFERTAS
   ---------------------------------------------------------------------
   Como funciona:
     1. Busca todos os produtos em /api/produtos (uma vez só).
     2. Guarda os filtros escolhidos no objeto "filtros".
     3. A função aplicarFiltros() devolve a lista filtrada e ordenada.
     4. desenharGrade() mostra os cartões (40 por vez, botão "Mostrar mais").
     5. Tocar num cartão abre a "folha" do produto, com as ações
        (ativar/pausar, editar, ver no site, copiar link, excluir).

   Rotas usadas (todas já existiam):
     GET    /api/produtos
     PATCH  /api/produtos/:id      -> alterna ativo/pausado
     DELETE /api/produtos/:id
     POST   /api/produtos/resolver-pendentes
     POST   /api/produtos/corrigir-sem-desconto

   Funções do menu.js usadas aqui: icone, abrirFolha, fecharFolha,
   cabecalhoFolha, mostrarAviso, escaparHtml, formatarPreco, numeroDoPreco.
   ===================================================================== */

let todosOsProdutos = [];

// Filtros atuais. null = "todos".
const filtros = {
    busca: "",
    status: "todas",       // "todas" | "ativas" | "pausadas"
    categoria: null,
    marketplace: null,
    origem: null,
    semLink: false,        // só ofertas com link de afiliado faltando
    ordem: "recentes"
};

const POR_VEZ = 40;                // quantos cartões aparecem de cada vez
let quantidadeVisivel = POR_VEZ;

/* ---------- Pequenas regras de negócio ---------- */

function linkSuspeito(produto) {

    const link = produto.linkAfiliado;

    return !link || link === "LINK_NAO_CONFIRMADO" || !String(link).startsWith("http");

}

// Desconto em % (usa o campo "desconto"; se não tiver, calcula pelos preços)
function calcularDesconto(produto) {

    const informado = Number(produto.desconto);

    if (informado > 0) return Math.round(informado);

    const atual = numeroDoPreco(produto.preco);
    const antigo = numeroDoPreco(produto.precoAntigo);

    if (atual && antigo && antigo > atual) {
        return Math.round((1 - atual / antigo) * 100);
    }

    return 0;

}

function nomeMarketplace(produto) {

    const chave = String(produto.marketplace || "").toLowerCase().replace(/\s+/g, "");

    if (chave === "mercadolivre") return "Mercado Livre";
    if (chave === "amazon") return "Amazon";
    if (chave === "shopee") return "Shopee";

    return produto.marketplace ? String(produto.marketplace) : "Outro";

}

function nomeOrigem(produto) {

    return produto.origem === "coletor" ? "Coletor" : "Manual";

}

function nomeCategoria(produto) {

    return (produto.categoria || "").trim() || "Sem categoria";

}

/* ---------- Carregar ---------- */
async function carregarProdutos() {

    // "Esqueletos" cinza enquanto carrega
    document.getElementById("gradeOfertas").innerHTML =
        Array(6).fill('<div><div class="carregando" style="aspect-ratio:1;"></div></div>').join("");

    try {

        const resposta = await fetch("/api/produtos");
        todosOsProdutos = await resposta.json();

        desenharTudo();

        // Se veio ?abrir=ID no endereço (ex.: da tela Início), abre esse produto
        const abrir = new URLSearchParams(window.location.search).get("abrir");
        if (abrir) abrirProduto(Number(abrir));

    } catch (erro) {

        console.error("Erro ao carregar produtos:", erro);
        document.getElementById("gradeOfertas").innerHTML = `
            <div class="estadoVazio">
                <strong>Não foi possível carregar as ofertas</strong>
                Confira sua internet e tente de novo.
                <br><button onclick="carregarProdutos()">Tentar de novo</button>
            </div>
        `;

    }

}

/* ---------- Filtrar e ordenar ---------- */

// "ignorar" = nome de um filtro para NÃO aplicar (usado para contar opções)
function aplicarFiltros(ignorar) {

    const termo = filtros.busca.trim().toLowerCase();

    let lista = todosOsProdutos.filter(produto => {

        if (ignorar !== "status") {
            if (filtros.status === "ativas" && !produto.ativo) return false;
            if (filtros.status === "pausadas" && produto.ativo) return false;
        }

        if (ignorar !== "categoria" && filtros.categoria && nomeCategoria(produto) !== filtros.categoria) return false;
        if (ignorar !== "marketplace" && filtros.marketplace && nomeMarketplace(produto) !== filtros.marketplace) return false;
        if (ignorar !== "origem" && filtros.origem && nomeOrigem(produto) !== filtros.origem) return false;
        if (ignorar !== "semLink" && filtros.semLink && !linkSuspeito(produto)) return false;

        // Busca pelo título, marca ou ID
        if (termo) {
            const texto = `${produto.titulo} ${produto.marca || ""} ${produto.id}`.toLowerCase();
            if (!texto.includes(termo)) return false;
        }

        return true;

    });

    // Ordenação
    const preco = p => numeroDoPreco(p.preco) ?? 0;

    if (filtros.ordem === "recentes") lista.sort((a, b) => b.id - a.id);
    if (filtros.ordem === "desconto") lista.sort((a, b) => calcularDesconto(b) - calcularDesconto(a));
    if (filtros.ordem === "menorPreco") lista.sort((a, b) => preco(a) - preco(b));
    if (filtros.ordem === "maiorPreco") lista.sort((a, b) => preco(b) - preco(a));

    return lista;

}

// Quantos filtros (além de status/busca) estão ligados — para a bolinha
function quantidadeFiltrosLigados() {

    return [filtros.categoria, filtros.marketplace, filtros.origem, filtros.semLink, filtros.status !== "todas"]
        .filter(Boolean).length;

}

// Conta quantos produtos cada opção de um filtro teria
function contarOpcoes(nomeFiltro, funcaoValor) {

    const contagem = {};

    aplicarFiltros(nomeFiltro).forEach(produto => {
        const valor = funcaoValor(produto);
        contagem[valor] = (contagem[valor] || 0) + 1;
    });

    return Object.entries(contagem).sort((a, b) => b[1] - a[1]);

}

/* ---------- Desenhar ---------- */
function desenharTudo() {

    desenharChips();
    desenharFiltrosLaterais();
    desenharGrade();

    document.getElementById("btnFiltros")
        .classList.toggle("comFiltro", quantidadeFiltrosLigados() > 0);

}

// Chips de categoria (celular)
function desenharChips() {

    const categorias = contarOpcoes("categoria", nomeCategoria);

    const chip = (valor, rotulo, qtd) => `
        <button class="chip ${filtros.categoria === valor ? "ativo" : ""}"
                data-filtro="categoria" data-valor="${escaparHtml(valor ?? "")}">
            ${escaparHtml(rotulo)} <span class="contador">${qtd}</span>
        </button>`;

    const total = categorias.reduce((soma, [, qtd]) => soma + qtd, 0);

    document.getElementById("chipsCategorias").innerHTML =
        chip(null, "Todas", total) + categorias.map(([nome, qtd]) => chip(nome, nome, qtd)).join("");

}

// Monta os grupos de filtro. "tipo" = "lista" (PC) ou "chip" (folha do celular)
function htmlGruposFiltro(tipo) {

    const opcao = (filtro, valor, rotulo, qtd, ativo) => tipo === "lista"
        ? `<button class="opcaoLista ${ativo ? "ativo" : ""}" data-filtro="${filtro}" data-valor="${escaparHtml(valor ?? "")}">
               <span>${escaparHtml(rotulo)}</span><span class="contador">${qtd ?? ""}</span>
           </button>`
        : `<button class="chip ${ativo ? "ativo" : ""}" data-filtro="${filtro}" data-valor="${escaparHtml(valor ?? "")}">
               ${escaparHtml(rotulo)} ${qtd !== undefined ? `<span class="contador">${qtd}</span>` : ""}
           </button>`;

    // Status
    const baseStatus = aplicarFiltros("status");
    const ativas = baseStatus.filter(p => p.ativo).length;

    const grupoStatus = `
        <div class="grupoFiltro">
            <h3>Status</h3>
            <div class="opcoes">
                ${opcao("status", "todas", "Todas", baseStatus.length, filtros.status === "todas")}
                ${opcao("status", "ativas", "Ativas", ativas, filtros.status === "ativas")}
                ${opcao("status", "pausadas", "Pausadas", baseStatus.length - ativas, filtros.status === "pausadas")}
            </div>
        </div>`;

    // Grupo genérico (categoria, marketplace, origem)
    const grupo = (titulo, filtro, funcaoValor) => {
        const itens = contarOpcoes(filtro, funcaoValor);
        const total = itens.reduce((s, [, q]) => s + q, 0);
        return `
            <div class="grupoFiltro">
                <h3>${titulo}</h3>
                <div class="opcoes">
                    ${opcao(filtro, "", "Todas", total, !filtros[filtro])}
                    ${itens.map(([nome, qtd]) => opcao(filtro, nome, nome, qtd, filtros[filtro] === nome)).join("")}
                </div>
            </div>`;
    };

    const semLinkQtd = aplicarFiltros("semLink").filter(linkSuspeito).length;

    const grupoProblemas = `
        <div class="grupoFiltro">
            <h3>Problemas</h3>
            <div class="opcoes">
                ${opcao("semLink", filtros.semLink ? "" : "sim", "Sem link de afiliado", semLinkQtd, filtros.semLink)}
            </div>
        </div>`;

    // No celular, categoria já aparece nos chips da tela, então não repete
    return grupoStatus
        + (tipo === "lista" ? grupo("Categoria", "categoria", nomeCategoria) : "")
        + grupo("Loja", "marketplace", nomeMarketplace)
        + grupo("Origem", "origem", nomeOrigem)
        + grupoProblemas;

}

function desenharFiltrosLaterais() {

    document.getElementById("filtrosLaterais").innerHTML = htmlGruposFiltro("lista");

}

// Um cartão de oferta
function htmlCartao(produto) {

    const desconto = calcularDesconto(produto);
    const antigo = numeroDoPreco(produto.precoAntigo);
    const atual = numeroDoPreco(produto.preco);

    const foto = produto.imagem
        ? `<img src="${escaparHtml(produto.imagem)}" alt="" loading="lazy" onerror="this.remove()">`
        : "";

    // Etiqueta no canto da foto: problema tem prioridade
    let etiqueta = "";
    if (linkSuspeito(produto)) etiqueta = `<span class="statusFoto aviso">Sem link</span>`;
    else if (!produto.ativo) etiqueta = `<span class="statusFoto">Pausada</span>`;

    return `
        <button class="cartaoOferta ${produto.ativo ? "" : "pausada"}" data-id="${produto.id}"
                aria-label="${escaparHtml(produto.titulo)}, ${produto.ativo ? "ativa" : "pausada"}">
            <div class="fotoOferta">
                ${desconto > 0 ? `<span class="seloDesconto">-${desconto}%</span>` : ""}
                <span class="pontoStatus"></span>
                ${foto || "Sem foto"}
                ${etiqueta}
            </div>
            <div class="infoOferta">
                <p class="tituloOferta">${escaparHtml(produto.titulo)}</p>
                ${antigo && atual && antigo > atual ? `<span class="precoAntigo">${formatarPreco(produto.precoAntigo)}</span>` : ""}
                <span class="precoAtual">${formatarPreco(produto.preco)}</span>
            </div>
        </button>
    `;

}

function desenharGrade() {

    const lista = aplicarFiltros();
    const grade = document.getElementById("gradeOfertas");
    const botaoMais = document.getElementById("btnMostrarMais");

    document.getElementById("resumoQuantidade").textContent =
        `${lista.length} ${lista.length === 1 ? "oferta" : "ofertas"}` +
        (lista.length !== todosOsProdutos.length ? ` de ${todosOsProdutos.length}` : "");

    if (lista.length === 0) {
        grade.innerHTML = `
            <div class="estadoVazio">
                <strong>Nenhuma oferta encontrada</strong>
                Tente outra busca ou limpe os filtros.
                <br><button onclick="limparFiltros()">Limpar filtros</button>
            </div>
        `;
        botaoMais.style.display = "none";
        return;
    }

    grade.innerHTML = lista.slice(0, quantidadeVisivel).map(htmlCartao).join("");

    const faltam = lista.length - quantidadeVisivel;
    botaoMais.style.display = faltam > 0 ? "" : "none";
    botaoMais.textContent = `Mostrar mais (${faltam})`;

}

/* ---------- Mudar filtros ---------- */
function definirFiltro(nome, valor) {

    if (nome === "semLink") {
        filtros.semLink = valor === "sim";
    } else if (nome === "status") {
        filtros.status = valor || "todas";
    } else {
        // Tocar de novo na opção já escolhida desmarca
        filtros[nome] = (!valor || filtros[nome] === valor) ? null : valor;
    }

    quantidadeVisivel = POR_VEZ;
    desenharTudo();

    // Se a folha de filtros estiver aberta, redesenha ela também
    const conteudoFiltros = document.getElementById("conteudoFolhaFiltros");
    if (conteudoFiltros) {
        conteudoFiltros.innerHTML = htmlGruposFiltro("chip");
        atualizarBotaoVerOfertas();
    }

}

function limparFiltros() {

    Object.assign(filtros, { busca: "", status: "todas", categoria: null, marketplace: null, origem: null, semLink: false });
    document.getElementById("filtroBusca").value = "";
    definirFiltro("status", "todas");

}

// Um único "ouvinte" de clique para TODOS os botões de filtro da página
// (chips, lista do PC e folha). Ele lê data-filtro e data-valor.
document.addEventListener("click", evento => {

    const botao = evento.target.closest("[data-filtro]");

    if (botao) {
        definirFiltro(botao.dataset.filtro, botao.dataset.valor);
        return;
    }

    const cartao = evento.target.closest(".cartaoOferta");

    if (cartao) abrirProduto(Number(cartao.dataset.id));

});

/* ---------- Folha de filtros (celular) ---------- */
function abrirFiltros() {

    abrirFolha(`
        ${cabecalhoFolha("Filtros")}
        <div id="conteudoFolhaFiltros">${htmlGruposFiltro("chip")}</div>
        <div class="rodapeFolha">
            <button onclick="limparFiltros()">Limpar</button>
            <button class="primario" id="btnVerOfertas" onclick="fecharFolha()">Ver ofertas</button>
        </div>
    `);

    atualizarBotaoVerOfertas();

}

function atualizarBotaoVerOfertas() {

    const botao = document.getElementById("btnVerOfertas");
    if (botao) botao.textContent = `Ver ${aplicarFiltros().length} ofertas`;

}

/* ---------- Folha do produto ---------- */
function abrirProduto(id) {

    const produto = todosOsProdutos.find(p => p.id === id);

    if (!produto) return;

    const desconto = calcularDesconto(produto);
    const antigo = numeroDoPreco(produto.precoAntigo);
    const atual = numeroDoPreco(produto.preco);
    const linkSite = produto.linkOriginal || produto.linkAfiliado;

    const ultima = produto.ultimaDivulgacao && !isNaN(new Date(produto.ultimaDivulgacao))
        ? `Última postagem: ${new Date(produto.ultimaDivulgacao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
        : "Ainda não foi postada";

    // Avisos que ajudam a entender por que a oferta está assim
    let avisos = "";

    if (linkSuspeito(produto)) {
        avisos += `<p class="avisoFolha">Sem link de afiliado confirmado. Toque em Editar para completar.</p>`;
    }

    if (!produto.ativo && produto.revisorMotivo) {
        avisos += `<p class="avisoFolha">Pausada pela revisão: ${escaparHtml(produto.revisorMotivo)}</p>`;
    }

    abrirFolha(`
        <div class="topoProdutoFolha">
            <div class="fotoOferta">
                ${produto.imagem ? `<img src="${escaparHtml(produto.imagem)}" alt="" onerror="this.remove()">` : "Sem foto"}
            </div>
            <div>
                <h2>${escaparHtml(produto.titulo)}</h2>
                <div class="metaProduto">
                    <span class="etiqueta neutra">${escaparHtml(nomeCategoria(produto))}</span>
                    <span class="etiqueta neutra">${escaparHtml(nomeMarketplace(produto))}</span>
                    <span class="etiqueta neutra">${nomeOrigem(produto)}</span>
                </div>
                <div class="precosFolha">
                    <span class="precoAtual">${formatarPreco(produto.preco)}</span>
                    ${antigo && atual && antigo > atual ? `<span class="precoAntigo">${formatarPreco(produto.precoAntigo)}</span>` : ""}
                    ${desconto > 0 ? `<span class="etiqueta marca">-${desconto}%</span>` : ""}
                </div>
            </div>
        </div>

        <label class="linhaInterruptor" for="interruptorFolha">
            <span>
                <strong>Divulgar nos grupos</strong>
                <small id="textoInterruptor">${produto.ativo ? "Ligada: o robô pode postar esta oferta" : "Pausada: o robô não posta esta oferta"}</small>
            </span>
            <span class="interruptor">
                <input type="checkbox" id="interruptorFolha" ${produto.ativo ? "checked" : ""} onchange="alterarStatus(${produto.id})">
                <span></span>
            </span>
        </label>

        ${avisos}

        <div class="gradeAcoes">
            <a href="/editar-produto?id=${produto.id}" class="botao">${icone("editar")} Editar</a>
            ${linkSite && String(linkSite).startsWith("http")
                ? `<a href="${escaparHtml(linkSite)}" target="_blank" rel="noopener" class="botao">${icone("externo")} Ver no site</a>`
                : `<button disabled>${icone("externo")} Sem link</button>`}
            <button onclick="copiarLink(${produto.id})" ${linkSuspeito(produto) ? "disabled" : ""}>${icone("copiar")} Copiar link</button>
        </div>

        <p class="infoFolha">ID ${produto.id} · ${ultima}</p>

        <button class="perigo largo" style="margin-top:16px;" onclick="excluirProduto(${produto.id})">${icone("lixeira")} Excluir oferta</button>
    `);

}

/* ---------- Ações ---------- */
async function alterarStatus(id) {

    const produto = todosOsProdutos.find(p => p.id === id);
    const interruptor = document.getElementById("interruptorFolha");

    if (interruptor) interruptor.disabled = true;

    try {

        const resposta = await fetch(`/api/produtos/${id}`, { method: "PATCH" });
        const resultado = await resposta.json();

        if (!resultado.sucesso) throw new Error(resultado.mensagem || "falhou");

        // A rota PATCH inverte o "ativo" no servidor; fazemos o mesmo aqui
        produto.ativo = !produto.ativo;

        const texto = document.getElementById("textoInterruptor");
        if (texto) {
            texto.textContent = produto.ativo
                ? "Ligada: o robô pode postar esta oferta"
                : "Pausada: o robô não posta esta oferta";
        }

        desenharTudo();
        mostrarAviso(produto.ativo ? "Oferta ativada" : "Oferta pausada");

    } catch (erro) {

        console.error("Erro ao alterar status:", erro);
        if (interruptor) interruptor.checked = produto.ativo;   // volta como estava
        mostrarAviso("Não deu certo. Tente de novo.", "erro");

    }

    if (interruptor) interruptor.disabled = false;

}

async function copiarLink(id) {

    const produto = todosOsProdutos.find(p => p.id === id);

    try {
        await navigator.clipboard.writeText(produto.linkAfiliado);
        mostrarAviso("Link de afiliado copiado");
    } catch (erro) {
        // Alguns navegadores bloqueiam a cópia: mostra o link para copiar na mão
        window.prompt("Copie o link:", produto.linkAfiliado);
    }

}

async function excluirProduto(id) {

    const confirmar = confirm("Excluir esta oferta?\n\nIsso não pode ser desfeito. Se quiser só parar de divulgar, use o botão de pausar.");

    if (!confirmar) return;

    try {

        const resposta = await fetch(`/api/produtos/${id}`, { method: "DELETE" });
        const resultado = await resposta.json();

        if (!resultado.sucesso) throw new Error(resultado.mensagem || "falhou");

        todosOsProdutos = todosOsProdutos.filter(p => p.id !== id);
        fecharFolha();
        desenharTudo();
        mostrarAviso("Oferta excluída");

    } catch (erro) {

        console.error("Erro ao excluir:", erro);
        mostrarAviso("Não foi possível excluir.", "erro");

    }

}

/* ---------- Ferramentas (menu ⋯) ---------- */
function abrirFerramentas() {

    abrirFolha(`
        ${cabecalhoFolha("Ferramentas")}
        <nav class="listaMenu">
            <button onclick="fecharFolha(); resolverPendentes();">
                <span class="quadradoIcone info">${icone("link")}</span>
                <span>Preencher fotos e links faltantes<small>Busca no Mercado Livre e na Amazon o que estiver faltando</small></span>
            </button>
            <button onclick="fecharFolha(); corrigirSemDesconto();">
                <span class="quadradoIcone aviso">${icone("ferramenta")}</span>
                <span>Pausar ofertas sem desconto real<small>Pausa as ofertas ativas cujo preço antigo não é maior que o atual</small></span>
            </button>
        </nav>
    `);

}

// Linha colorida no log das ferramentas
function adicionarLinhaLogResolucao(texto, tipo) {

    const area = document.getElementById("areaResolucao");
    const linha = document.createElement("div");
    linha.className = `linhaLog linhaLog-${tipo || "info"}`;
    linha.textContent = texto;
    area.appendChild(linha);
    area.scrollTop = area.scrollHeight;

}

// Preenche link original + imagem dos produtos que estão sem.
// O servidor responde aos poucos (streaming SSE), e mostramos cada linha.
async function resolverPendentes() {

    const mensagem = document.getElementById("mensagemResolucao");
    const area = document.getElementById("areaResolucao");

    mensagem.className = "mensagemFormulario";
    mensagem.textContent = "Preenchendo fotos e links...";
    area.style.display = "block";
    area.innerHTML = "";
    area.scrollIntoView({ behavior: "smooth", block: "center" });

    try {

        const resposta = await fetch("/api/produtos/resolver-pendentes", { method: "POST" });

        if (!resposta.ok || !resposta.body) {
            adicionarLinhaLogResolucao("Erro ao conectar com o servidor.", "erro");
            return;
        }

        const leitor = resposta.body.getReader();
        const decodificador = new TextDecoder();
        let bufferTexto = "";

        while (true) {

            const { done, value } = await leitor.read();

            if (done) break;

            bufferTexto += decodificador.decode(value, { stream: true });

            // Cada evento SSE termina com uma linha em branco ("\n\n")
            const partes = bufferTexto.split("\n\n");
            bufferTexto = partes.pop();

            for (const parte of partes) {

                const linhaEvento = parte.split("\n").find(l => l.startsWith("event:"));
                const linhaDados = parte.split("\n").find(l => l.startsWith("data:"));

                if (!linhaEvento || !linhaDados) continue;

                const tipo = linhaEvento.replace("event:", "").trim();
                const dados = JSON.parse(linhaDados.replace("data:", "").trim());

                if (tipo === "inicio") {
                    adicionarLinhaLogResolucao(dados.total === 0
                        ? "Nenhum produto pendente: todos já têm link original e imagem."
                        : `${dados.total} produto(s) pendente(s). Isso pode levar alguns minutos...`,
                        dados.total === 0 ? "sucesso" : "info");
                }

                if (tipo === "produto") {
                    adicionarLinhaLogResolucao(
                        `#${dados.produtoId} ${String(dados.titulo).slice(0, 50)}: ${dados.sucesso ? "resolvido" : "não foi possível resolver"}`,
                        dados.sucesso ? "sucesso" : "aviso");
                }

                if (tipo === "final") {
                    adicionarLinhaLogResolucao(`Concluído: ${dados.resolvidos} resolvido(s), ${dados.falhas} não resolvido(s).`, "sucesso");
                    mensagem.className = "mensagemFormulario sucesso";
                    mensagem.textContent = "Pronto. Lista atualizada.";
                    carregarProdutos();
                }

            }

        }

    } catch (erro) {

        adicionarLinhaLogResolucao(`Erro de conexão: ${erro.message}`, "erro");

    }

}

// Pausa de uma vez as ofertas ativas sem desconto real
async function corrigirSemDesconto() {

    const confirmar = confirm("Pausar todas as ofertas ativas que não têm desconto real?");

    if (!confirmar) return;

    try {

        const resposta = await fetch("/api/produtos/corrigir-sem-desconto", { method: "POST" });
        const resultado = await resposta.json();

        if (!resultado.sucesso) throw new Error(resultado.mensagem || "Erro ao corrigir produtos.");

        mostrarAviso(resultado.corrigidos > 0
            ? `${resultado.corrigidos} oferta(s) pausada(s)`
            : "Nenhuma oferta sem desconto real");

        carregarProdutos();

    } catch (erro) {

        mostrarAviso(erro.message, "erro");

    }

}

/* ---------- Começo ---------- */

// Ícones dos botões do topo
document.getElementById("btnFerramentas").innerHTML = icone("mais");
document.getElementById("btnNovaOferta").innerHTML = `${icone("mais_simbolo")}<span class="soPC">Nova oferta</span>`;
document.getElementById("btnFiltros").innerHTML = icone("filtro");

document.getElementById("btnFerramentas").addEventListener("click", abrirFerramentas);
document.getElementById("btnFiltros").addEventListener("click", abrirFiltros);

document.getElementById("btnMostrarMais").addEventListener("click", () => {
    quantidadeVisivel += POR_VEZ;
    desenharGrade();
});

document.getElementById("filtroBusca").addEventListener("input", evento => {
    filtros.busca = evento.target.value;
    quantidadeVisivel = POR_VEZ;
    desenharTudo();
});

document.getElementById("ordem").addEventListener("change", evento => {
    filtros.ordem = evento.target.value;
    desenharGrade();
});

// Filtros que podem vir no endereço (links da tela Início)
const parametros = new URLSearchParams(window.location.search);
if (parametros.get("status")) filtros.status = parametros.get("status");
if (parametros.get("categoria")) filtros.categoria = parametros.get("categoria");
if (parametros.get("filtro") === "semlink") filtros.semLink = true;

carregarProdutos();
