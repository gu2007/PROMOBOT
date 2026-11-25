/* =====================================================================
   menu.js — navegação e "ferramentas" que TODAS as páginas usam
   ---------------------------------------------------------------------
   Este arquivo é carregado no fim de toda página (<script src="menu.js">).
   Ele:
     1. Desenha a navegação nova: barra de abas embaixo (celular) e barra
        no topo (PC). Assim não precisamos repetir o menu em cada HTML.
     2. Remove o menu antigo (sidebar) se a página ainda tiver ele.
     3. Oferece funções globais que as outras telas usam:
          icone(nome)            -> devolve o <svg> de um ícone
          abrirFolha(html)       -> abre o painel que sobe de baixo
          fecharFolha()          -> fecha esse painel
          mostrarAviso(texto)    -> aviso rápido que some sozinho
          escaparHtml(texto)     -> protege textos antes de pôr no HTML
          formatarPreco(valor)   -> "R$ 1.299,90"
   ===================================================================== */

/* ---------- 1. ÍCONES ---------------------------------------------------
   Desenhos simples em SVG (traço), no estilo "outline". Cada valor é só o
   "miolo" do SVG; a função icone() coloca a moldura <svg> em volta. */
const ICONES = {
    inicio: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    ofertas: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    grupos: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    mais: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    sacola: '<path d="M5 8h14l-1 12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M12 17.5s-2.5-1.5-2.5-3.1a1.3 1.3 0 0 1 2.5-.6 1.3 1.3 0 0 1 2.5.6c0 1.6-2.5 3.1-2.5 3.1Z"/>',
    mais_simbolo: '<path d="M12 5v14M5 12h14"/>',
    filtro: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    lixeira: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    externo: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    copiar: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    importar: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
    duplicados: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    alteracoes: '<path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/>',
    ajustes: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    estilo: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M12 21a2 2 0 0 1 0-4h1.5a2 2 0 0 0 0-4"/>',
    sair: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
    seta: '<path d="m9 6 6 6-6 6"/>',
    fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    ferramenta: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5 2.5-2.5Z"/>',
    pausar: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>'
};

function icone(nome, classeExtra) {

    const miolo = ICONES[nome] || "";

    return `<svg class="icone ${classeExtra || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${miolo}</svg>`;

}

/* ---------- 2. UTILITÁRIOS -------------------------------------------- */

// Troca < > & " ' por códigos seguros. Use SEMPRE antes de colocar um
// texto que veio do banco (ex.: título do produto) dentro de innerHTML.
// Isso evita que um título "malicioso" vire código na página.
function escaparHtml(texto) {

    return String(texto ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

// Converte o preço (que pode vir como 159.9, "159.90" ou "1.299,90") em número.
function numeroDoPreco(valor) {

    if (typeof valor === "number") return valor;

    let texto = String(valor ?? "").replace(/[^\d,.-]/g, "");

    if (texto.includes(",")) {
        // Formato brasileiro: tira os pontos de milhar e troca vírgula por ponto
        texto = texto.replace(/\./g, "").replace(",", ".");
    }

    const numero = parseFloat(texto);

    return isNaN(numero) ? null : numero;

}

// 159.9 -> "R$ 159,90"
function formatarPreco(valor) {

    const numero = numeroDoPreco(valor);

    if (numero === null) return valor ? `R$ ${valor}` : "";

    return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

}

/* ---------- 3. AVISO RÁPIDO (toast) ------------------------------------ */
let temporizadorAviso = null;

function mostrarAviso(texto, tipo) {

    let aviso = document.getElementById("avisoRapido");

    if (!aviso) {
        aviso = document.createElement("div");
        aviso.id = "avisoRapido";
        aviso.setAttribute("role", "status");   // leitor de tela lê o aviso
        document.body.appendChild(aviso);
    }

    aviso.className = "toast" + (tipo === "erro" ? " erro" : "");
    aviso.textContent = texto;

    // Pequeno atraso para a animação de entrada funcionar
    requestAnimationFrame(() => aviso.classList.add("visivel"));

    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => aviso.classList.remove("visivel"), 2600);

}

/* ---------- 4. FOLHA (painel que sobe de baixo) ------------------------ */
// Uso: abrirFolha(`<h2>Título</h2> ...`)
// Fecha tocando fora, no X ou apertando Esc.
function abrirFolha(conteudoHtml) {

    fecharFolha(true);

    const fundo = document.createElement("div");
    fundo.className = "fundoFolha";
    fundo.id = "fundoFolha";

    fundo.innerHTML = `
        <div class="folha" role="dialog" aria-modal="true">
            <div class="alcaFolha"></div>
            ${conteudoHtml}
        </div>
    `;

    // Tocar no fundo escuro (fora da folha) fecha
    fundo.addEventListener("click", evento => {
        if (evento.target === fundo) fecharFolha();
    });

    document.body.appendChild(fundo);
    document.body.style.overflow = "hidden";     // trava a rolagem atrás

    requestAnimationFrame(() => fundo.classList.add("aberta"));

    // Coloca o foco dentro da folha (acessibilidade/teclado)
    const primeiroBotao = fundo.querySelector("button, a, input");
    if (primeiroBotao) primeiroBotao.focus({ preventScroll: true });

    return fundo.querySelector(".folha");

}

function fecharFolha(semAnimacao) {

    const fundo = document.getElementById("fundoFolha");

    if (!fundo) return;

    document.body.style.overflow = "";

    if (semAnimacao) {
        fundo.remove();
        return;
    }

    fundo.classList.remove("aberta");
    setTimeout(() => fundo.remove(), 220);

}

document.addEventListener("keydown", evento => {
    if (evento.key === "Escape") fecharFolha();
});

// Cabeçalho padrão de folha com título e botão X
function cabecalhoFolha(titulo) {

    return `
        <div class="cabecalhoFolha">
            <h2>${escaparHtml(titulo)}</h2>
            <button class="fantasma redondo" onclick="fecharFolha()" aria-label="Fechar">${icone("fechar")}</button>
        </div>
    `;

}

/* ---------- 5. NAVEGAÇÃO ------------------------------------------------ */

// Descobre em qual aba estamos olhando o endereço da página.
function abaAtual() {

    const caminho = window.location.pathname.replace(/\.html$/, "").replace(/\/$/, "");

    if (caminho === "" || caminho === "/index") return "inicio";
    if (["/produtos", "/editar-produto", "/novo-produto"].includes(caminho)) return "ofertas";
    if (caminho === "/grupos") return "grupos";

    return "mais";

}

// Itens que ficam dentro de "Mais"
const ITENS_MAIS = [
    { href: "/novo-produto", icone: "mais_simbolo", titulo: "Nova oferta", dica: "Cadastrar um produto na mão" },
    { href: "/importar-ia", icone: "importar", titulo: "Importar", dica: "Trazer produtos por link, arquivo ou texto" },
    { href: "/alteracoes", icone: "alteracoes", titulo: "Mudanças de preço", dica: "O que a verificação semanal encontrou" },
    { href: "/duplicados", icone: "duplicados", titulo: "Duplicados", dica: "Produtos que parecem repetidos" },
    { href: "/configuracoes", icone: "ajustes", titulo: "Ajustes do robô", dica: "Horário e quantidade de postagens" },
    { href: "/estilo.html", icone: "estilo", titulo: "Guia de estilo", dica: "Peças do visual do painel" }
];

function abrirMenuMais() {

    const links = ITENS_MAIS.map(item => `
        <a href="${item.href}">
            <span class="quadradoIcone">${icone(item.icone)}</span>
            <span>${item.titulo}<small>${item.dica}</small></span>
            <span class="seta">${icone("seta")}</span>
        </a>
    `).join("");

    abrirFolha(`
        ${cabecalhoFolha("Mais")}
        <nav class="listaMenu">
            ${links}
            <button type="button" onclick="sairDoPainel()">
                <span class="quadradoIcone perigo">${icone("sair")}</span>
                <span>Sair</span>
            </button>
        </nav>
    `);

}

async function sairDoPainel() {

    try {
        // Tenta POST; se a rota do back-end for GET, tenta GET
        const resposta = await fetch("/api/auth/logout", { method: "POST" });
        if (!resposta.ok) await fetch("/api/auth/logout");
    } catch (erro) {
        console.error("Erro ao sair:", erro);
    }

    window.location.href = "/login";

}

function montarNavegacao() {

    // Página de login não tem navegação
    if (document.querySelector(".login-page")) return;

    // Remove o menu antigo, se existir no HTML
    ["sidebar", "botaoMenu", "overlayMenu"].forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.remove();
    });

    const atual = abaAtual();

    // Função pequena que marca o link da aba atual
    const marcar = nome => (nome === atual ? ' class="ativo" aria-current="page"' : "");

    /* --- Barra do topo (PC) --- */
    const topo = document.createElement("header");
    topo.className = "navTopo";
    topo.innerHTML = `
        <a href="/" class="marcaLogo">
            <span class="iconeMarca">${icone("sacola")}</span>
            I Ama Promos
        </a>
        <nav class="linksTopo" aria-label="Navegação principal">
            <a href="/"${marcar("inicio")}>${icone("inicio")} Início</a>
            <a href="/produtos"${marcar("ofertas")}>${icone("ofertas")} Ofertas</a>
            <a href="/grupos.html"${marcar("grupos")}>${icone("grupos")} Grupos</a>
            <button type="button"${marcar("mais")} onclick="abrirMenuMais()">${icone("mais")} Mais</button>
        </nav>
        <div class="direitaTopo">
            <a href="/" class="statusTopo" id="statusTopo">Robô</a>
        </div>
    `;
    document.body.prepend(topo);

    /* --- Barra de abas (celular) --- */
    const baixo = document.createElement("nav");
    baixo.className = "navBaixo";
    baixo.setAttribute("aria-label", "Navegação principal");
    baixo.innerHTML = `
        <a href="/"${marcar("inicio")}><span class="fundoIcone">${icone("inicio")}</span>Início</a>
        <a href="/produtos"${marcar("ofertas")}><span class="fundoIcone">${icone("ofertas")}</span>Ofertas</a>
        <a href="/grupos.html"${marcar("grupos")}><span class="fundoIcone">${icone("grupos")}</span>Grupos</a>
        <button type="button"${marcar("mais")} onclick="abrirMenuMais()"><span class="fundoIcone">${icone("mais")}</span>Mais</button>
    `;
    document.body.appendChild(baixo);

    atualizarStatusTopo();

}

// Mostra "Robô postando" / "Robô pausado" na barra do PC
async function atualizarStatusTopo() {

    const pilula = document.getElementById("statusTopo");

    if (!pilula) return;

    try {

        const resposta = await fetch("/api/config/status");
        const status = await resposta.json();

        pilula.className = "statusTopo " + (status.sistemaAtivo ? "online" : "pausado");
        pilula.textContent = status.sistemaAtivo ? "Robô postando" : "Robô pausado";

    } catch (erro) {

        pilula.textContent = "Robô";

    }

}

// Roda assim que o arquivo carrega (ele fica no fim do <body>)
montarNavegacao();
