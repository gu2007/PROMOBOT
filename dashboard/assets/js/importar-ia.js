let produtosEncontrados = [];

// ======================================
// Controle das abas (Link / Arquivo / Texto)
// ======================================
function mudarAba(aba) {

    document.getElementById('abaLink').style.display = aba === 'link' ? 'block' : 'none';
    document.getElementById('abaArquivo').style.display = aba === 'arquivo' ? 'block' : 'none';
    document.getElementById('abaTexto').style.display = aba === 'texto' ? 'block' : 'none';

    document.querySelectorAll('.abaFormulario').forEach(botao => {
        botao.classList.toggle('ativa', botao.dataset.aba === aba);
    });

}

// ======================================
// Funções do log de atividade visual (substituem o antigo terminal preto):
// linhas de status coloridas por tipo, bloco recolhível com o prompt
// enviado à IA, e um bloco separado acumulando a resposta em streaming.
// ======================================
let elementoRespostaAtual = null;

function adicionarLinhaLog(texto, tipo) {
    const areaStreaming = document.getElementById('areaStreaming');
    const linha = document.createElement('div');
    linha.className = `linhaLog linhaLog-${tipo || 'info'}`;
    linha.textContent = texto;
    areaStreaming.appendChild(linha);
    areaStreaming.scrollTop = areaStreaming.scrollHeight;
}

function mostrarPrompt(texto) {
    const areaStreaming = document.getElementById('areaStreaming');
    const bloco = document.createElement('details');
    bloco.className = 'blocoPrompt';
    const resumo = document.createElement('summary');
    resumo.textContent = 'Ver prompt enviado à IA';
    const pre = document.createElement('pre');
    pre.textContent = texto;
    bloco.appendChild(resumo);
    bloco.appendChild(pre);
    areaStreaming.appendChild(bloco);
    areaStreaming.scrollTop = areaStreaming.scrollHeight;
}

function adicionarTrechoResposta(texto) {
    const areaStreaming = document.getElementById('areaStreaming');
    if (!elementoRespostaAtual) {
        elementoRespostaAtual = document.createElement('pre');
        elementoRespostaAtual.className = 'blocoResposta';
        areaStreaming.appendChild(elementoRespostaAtual);
    }
    elementoRespostaAtual.textContent += texto;
    areaStreaming.scrollTop = areaStreaming.scrollHeight;
}

// ======================================
// Função genérica que processa a transmissão (SSE) vinda do servidor,
// usada pelas 3 formas de busca (link, arquivo, texto)
// ======================================
async function processarStream(resposta) {

    const mensagemStatus = document.getElementById('mensagemStatus');

    if (!resposta.ok || !resposta.body) {
        adicionarLinhaLog('Erro ao conectar com o servidor.', 'erro');
        return;
    }

    elementoRespostaAtual = null;

    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    let bufferTexto = '';

    while (true) {

        const { done, value } = await leitor.read();

        if (done) break;

        bufferTexto += decodificador.decode(value, { stream: true });

        const partes = bufferTexto.split('\n\n');
        bufferTexto = partes.pop();

        for (const parte of partes) {

            const linhaEvento = parte.split('\n').find(l => l.startsWith('event:'));
            const linhaDados = parte.split('\n').find(l => l.startsWith('data:'));

            if (!linhaEvento || !linhaDados) continue;

            const tipo = linhaEvento.replace('event:', '').trim();
            const dados = JSON.parse(linhaDados.replace('data:', '').trim());

            if (tipo === 'prompt') {
                mostrarPrompt(dados.texto);
            }

            if (tipo === 'status') {
                adicionarLinhaLog(dados.mensagem, 'info');
            }

            if (tipo === 'trecho') {
                adicionarTrechoResposta(dados.texto);
            }

            if (tipo === 'erro') {
                adicionarLinhaLog(dados.mensagem, 'erro');
                mensagemStatus.className = 'mensagemFormulario erro';
                mensagemStatus.textContent = dados.mensagem;
            }

            if (tipo === 'final') {
                produtosEncontrados = dados.produtos;
                mensagemStatus.className = 'mensagemFormulario sucesso';
                mensagemStatus.textContent = `${produtosEncontrados.length} produto(s) encontrado(s). Busque o link de cada um e cole na caixinha antes de salvar.`;
                adicionarLinhaLog('Concluído.', 'sucesso');
                renderizarResultados();
            }

        }

    }

}

function prepararTelaParaBusca() {

    const mensagemStatus = document.getElementById('mensagemStatus');
    const areaStreaming = document.getElementById('areaStreaming');
    const resultados = document.getElementById('resultados');

    mensagemStatus.className = 'mensagemFormulario';
    mensagemStatus.textContent = '';
    areaStreaming.style.display = 'block';
    areaStreaming.innerHTML = '';
    resultados.innerHTML = '';

    adicionarLinhaLog('Iniciando...', 'info');

}

// ======================================
// FORMA 1 — Buscar produtos por LINK
// ======================================
async function buscarProdutosPorLink() {

    const link = document.getElementById('linkPagina').value.trim();
    const mensagemStatus = document.getElementById('mensagemStatus');
    const botao = document.getElementById('btnBuscarLink');

    if (!link) {
        mensagemStatus.className = 'mensagemFormulario erro';
        mensagemStatus.textContent = 'Cole um link antes de buscar.';
        return;
    }

    prepararTelaParaBusca();
    botao.disabled = true;

    try {

        const resposta = await fetch('/api/ia/extrair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link })
        });

        await processarStream(resposta);

    } catch (erro) {

        adicionarLinhaLog(`Erro de conexão: ${erro.message}`, 'erro');
        mensagemStatus.className = 'mensagemFormulario erro';
        mensagemStatus.textContent = 'Erro de conexão ao buscar produtos.';

    }

    botao.disabled = false;

}

// ======================================
// FORMA 2 — Buscar produtos por ARQUIVO (PDF ou Word)
// ======================================
async function buscarProdutosPorArquivo() {

    const inputArquivo = document.getElementById('arquivoProdutos');
    const mensagemStatus = document.getElementById('mensagemStatus');
    const botao = document.getElementById('btnBuscarArquivo');

    if (!inputArquivo.files || inputArquivo.files.length === 0) {
        mensagemStatus.className = 'mensagemFormulario erro';
        mensagemStatus.textContent = 'Selecione um arquivo antes de buscar.';
        return;
    }

    prepararTelaParaBusca();
    botao.disabled = true;

    try {

        const formData = new FormData();
        formData.append('arquivo', inputArquivo.files[0]);

        const resposta = await fetch('/api/ia/extrair-arquivo', {
            method: 'POST',
            body: formData
        });

        await processarStream(resposta);

    } catch (erro) {

        adicionarLinhaLog(`Erro de conexão: ${erro.message}`, 'erro');
        mensagemStatus.className = 'mensagemFormulario erro';
        mensagemStatus.textContent = 'Erro de conexão ao buscar produtos.';

    }

    botao.disabled = false;

}

// ======================================
// FORMA 3 — Buscar produtos por TEXTO colado
// ======================================
async function buscarProdutosPorTexto() {

    const texto = document.getElementById('textoProdutos').value.trim();
    const mensagemStatus = document.getElementById('mensagemStatus');
    const botao = document.getElementById('btnBuscarTexto');

    if (!texto) {
        mensagemStatus.className = 'mensagemFormulario erro';
        mensagemStatus.textContent = 'Cole o texto antes de buscar.';
        return;
    }

    prepararTelaParaBusca();
    botao.disabled = true;

    try {

        const resposta = await fetch('/api/ia/extrair-texto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto })
        });

        await processarStream(resposta);

    } catch (erro) {

        adicionarLinhaLog(`Erro de conexão: ${erro.message}`, 'erro');
        mensagemStatus.className = 'mensagemFormulario erro';
        mensagemStatus.textContent = 'Erro de conexão ao buscar produtos.';

    }

    botao.disabled = false;

}

// ======================================
// Monta a URL de busca mecânica (sem IA) certa pra cada marketplace.
//
// Pro Mercado Livre, aplica 2 filtros "escondidos" de URL do próprio site,
// combinados, pra estreitar a busca do jeito mais preciso possível — tudo
// rodando no SEU navegador (sem automação de servidor, então sem risco
// nenhum de bloqueio por bot):
//
//  1) Título entre aspas — trata como frase, não palavras soltas.
//  2) "_PriceRange_MINBRL-MAXBRL" — faixa de preço quase exata (arredonda
//     só os centavos pra cima/baixo), em vez de uma margem ampla.
//  3) "_ITEM*CONDITION_2230284_" — só produtos NOVOS (nunca usados), já
//     que é tudo que esse sistema cadastra.
//
// O filtro de desconto ("_Discount_MIN-MAX") foi REMOVIDO depois de um
// teste ao vivo mostrar que ele às vezes EXCLUI o produto certo da lista —
// o cálculo de desconto que fazemos (a partir de preço e preço antigo que
// a IA extraiu) nem sempre bate exatamente com o que o Mercado Livre
// registra oficialmente pra aquele item, e quando não bate, o filtro
// derruba o produto certo em vez de ajudar. Sem ele, título + preço já
// reduz bem os candidatos, sem esse risco de "produto inexistente" falso.
//
// Pra Amazon, os filtros são diferentes dos do ML em dois pontos
// importantes, descobertos testando ao vivo:
//
//  1) SEM aspas no título — testamos com aspas (frase exata) e a busca da
//     Amazon retornou ZERO resultados sempre que o título da IA tinha
//     qualquer diferença de ordem/palavra em relação ao título real do
//     anúncio (diferente do Mercado Livre, que tolerou bem frase exata).
//     Sem aspas, a busca da Amazon já é naturalmente mais restritiva que a
//     do ML, então não sobra ruído mesmo assim.
//  2) "p_36:MINCENTAVOS-MAXCENTAVOS" com margem de 15% (não quase-exata)
//     — uma faixa muito apertada (tipo R$1 de largura) fez o filtro de
//     preço da Amazon não encontrar NADA, mesmo com o produto certo dentro
//     da faixa. Com margem de 15% (mesmo padrão usado antes no ML) voltou
//     a funcionar normalmente.
//  3) "p_n_condition-type:13862762011" — só produtos NOVOS, igual ao ML.
//
// Cada filtro é opcional: se faltar preço, o filtro de preço simplesmente
// não entra na URL — nunca quebra a busca.
// ======================================
function montarInfoBuscaMarketplace(marketplace, titulo, preco, precoAntigo) {

    const marketplaceNormalizado = (marketplace || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');

    if (marketplaceNormalizado === 'amazon') {

        const termoBuscaAmazon = encodeURIComponent(titulo);

        let refinamentos = 'p_n_condition-type:13862762011';

        if (typeof preco === 'number' && preco > 0) {

            const margem = 0.15;
            const minCentavos = Math.max(0, Math.floor(preco * (1 - margem))) * 100;
            const maxCentavos = Math.ceil(preco * (1 + margem)) * 100;

            refinamentos = `p_36:${minCentavos}-${maxCentavos},${refinamentos}`;

        }

        return {
            url: `https://www.amazon.com.br/s?k=${termoBuscaAmazon}&rh=${encodeURIComponent(refinamentos)}`,
            rotulo: 'Amazon'
        };

    }

    if (marketplaceNormalizado === 'shopee') {
        return {
            url: `https://shopee.com.br/search?keyword=${encodeURIComponent(titulo)}`,
            rotulo: 'Shopee'
        };
    }

    // Padrão: Mercado Livre (também usado se a IA não identificar o marketplace)
    const termoBusca = encodeURIComponent(`"${titulo}"`);

    let filtros = '';

    if (typeof preco === 'number' && preco > 0) {

        const precoMinimo = Math.floor(preco);
        const precoMaximo = Math.ceil(preco);

        filtros += `_PriceRange_${precoMinimo}BRL-${precoMaximo}BRL`;

    }

    filtros += '_ITEM*CONDITION_2230284_NoIndex_True';

    return {
        url: `https://lista.mercadolivre.com.br/${termoBusca}${filtros}`,
        rotulo: 'Mercado Livre'
    };

}

// ======================================
// Botão "Colar" nos campos de link — usa a área de transferência do
// navegador (só funciona em HTTPS, que já está configurado). Preenche o
// campo certo e dispara o ajuste de altura do campoExpandivel manualmente,
// já que preencher .value por código não gera o evento de digitação normal
// que o expandivel.js escuta.
// ======================================
async function colarDoClipboard(botao) {

    const seletor = botao.dataset.alvo === 'original'
        ? `.inputLinkOriginalProduto[data-indice="${botao.dataset.indice}"]`
        : `.inputLinkProduto[data-indice="${botao.dataset.indice}"]`;

    const campo = document.querySelector(seletor);

    if (!campo) return;

    if (!navigator.clipboard || !navigator.clipboard.readText) {
        alert('Colar automático não é suportado nesse navegador. Toque e segure no campo pra colar manualmente.');
        return;
    }

    try {

        const texto = await navigator.clipboard.readText();

        campo.value = texto;
        ajustarAlturaTextarea(campo);

    } catch (erro) {

        console.error('Erro ao colar do clipboard:', erro);
        alert('Não consegui acessar a área de transferência. Toque e segure no campo pra colar manualmente.');

    }

}

function inicializarBotoesColar(escopo) {

    const raiz = escopo || document;

    raiz.querySelectorAll('.botaoColarClipboard').forEach(botao => {

        if (!botao.dataset.colarPronto) {
            botao.dataset.colarPronto = '1';
            botao.addEventListener('click', () => colarDoClipboard(botao));
        }

    });

}

// ======================================
// Renderização dos resultados (igual para as 3 formas)
// ======================================
function renderizarResultados() {

    const resultados = document.getElementById('resultados');

    resultados.innerHTML = '';

    produtosEncontrados.forEach((produto, indice) => {

        const div = document.createElement('div');
        div.className = 'cartaoResultadoImportacao';

        const infoBusca = montarInfoBuscaMarketplace(produto.marketplace, produto.titulo, produto.preco, produto.precoAntigo);

        const precoHtml = produto.precoAntigo
            ? `<s style="color:var(--cor-texto-terciario); font-size:13px;">R$ ${produto.precoAntigo}</s> R$ ${produto.preco}`
            : `R$ ${produto.preco}`;

        div.innerHTML = `
            <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
                <input type="checkbox" class="checkboxProduto" data-indice="${indice}" checked style="margin-top:3px;">
                <span class="tituloResultado">${produto.titulo}</span>
            </label>
            <p class="precoProduto" style="margin:8px 0 4px;">${precoHtml}</p>
            <p class="metaResultado">${produto.categoria || 'Sem categoria'}${produto.marca ? ' · ' + produto.marca : ''}</p>
            ${produto.texto ? `<p class="textoVendaResultado">${produto.texto}</p>` : ''}
            <a href="${infoBusca.url}" target="_blank">
                <button type="button" class="botaoSecundario">Buscar produto no ${infoBusca.rotulo}</button>
            </a>
            <div class="campoFormulario" style="margin-top:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <label>Link de afiliado (pra enviar no WhatsApp)</label>
                    <button type="button" class="botaoColarClipboard" data-alvo="afiliado" data-indice="${indice}" style="white-space:nowrap; padding:4px 10px; font-size:13px;">📋 Colar</button>
                </div>
                <textarea class="inputLinkProduto campoExpandivel" rows="1" data-indice="${indice}" placeholder="https://..."></textarea>
            </div>
            <div class="campoFormulario">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <label>Link original da página do produto (sem afiliado — usado na verificação semanal de preço)</label>
                    <button type="button" class="botaoColarClipboard" data-alvo="original" data-indice="${indice}" style="white-space:nowrap; padding:4px 10px; font-size:13px;">📋 Colar</button>
                </div>
                <textarea class="inputLinkOriginalProduto campoExpandivel" rows="1" data-indice="${indice}" placeholder="https://..."></textarea>
            </div>
        `;

        resultados.appendChild(div);

    });

    inicializarCamposExpandiveis(resultados);
    inicializarBotoesColar(resultados);

    if (produtosEncontrados.length > 0) {

        const botaoSalvar = document.createElement('button');
        botaoSalvar.textContent = 'Salvar produtos selecionados';
        botaoSalvar.id = 'btnSalvarSelecionados';
        botaoSalvar.className = 'primario';
        botaoSalvar.style.marginTop = '4px';
        botaoSalvar.addEventListener('click', salvarSelecionados);
        resultados.appendChild(botaoSalvar);

    }

}

// ======================================
// Salvar os produtos selecionados (igual para as 3 formas). Se o link de
// afiliado já foi preenchido, o produto entra ATIVO direto na lista — não
// precisa de segurança extra, já que sem link ele nem seria divulgado
// mesmo. Se o link ficou em branco, entra inativo, do jeito de sempre.
// ======================================
async function salvarSelecionados() {

    const checkboxes = document.querySelectorAll('.checkboxProduto:checked');
    const mensagemStatus = document.getElementById('mensagemStatus');

    if (checkboxes.length === 0) {
        mensagemStatus.className = 'mensagemFormulario erro';
        mensagemStatus.textContent = 'Selecione ao menos um produto para salvar.';
        return;
    }

    let salvos = 0;
    let falhas = 0;
    let ultimoErro = '';

    for (const checkbox of checkboxes) {

        const indice = Number(checkbox.dataset.indice);
        const produto = produtosEncontrados[indice];

        const campoLink = document.querySelector(`.inputLinkProduto[data-indice="${indice}"]`);
        const linkDigitado = campoLink ? campoLink.value.trim() : '';

        const campoLinkOriginal = document.querySelector(`.inputLinkOriginalProduto[data-indice="${indice}"]`);
        const linkOriginalDigitado = campoLinkOriginal ? campoLinkOriginal.value.trim() : '';

        const produtoParaSalvar = {
            marketplace: produto.marketplace,
            categoria: produto.categoria,
            marca: produto.marca,
            titulo: produto.titulo,
            preco: produto.preco,
            precoAntigo: produto.precoAntigo,
            desconto: produto.desconto,
            avaliacao: produto.avaliacao,
            vendidos: produto.vendidos,
            imagem: null,
            linkAfiliado: linkDigitado || 'LINK_NAO_CONFIRMADO',
            linkOriginal: linkOriginalDigitado || null,
            texto: produto.texto,
            ativo: !!linkDigitado
        };

        try {

            const resposta = await fetch('/api/produtos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(produtoParaSalvar)
            });

            if (!resposta.ok) {

                falhas++;

                let corpoErro = '';
                try {
                    const dadosErro = await resposta.json();
                    corpoErro = dadosErro.mensagem || JSON.stringify(dadosErro);
                } catch (e) {
                    corpoErro = await resposta.text();
                }

                ultimoErro = `HTTP ${resposta.status}: ${corpoErro}`;
                console.error(`Erro ao salvar "${produto.titulo}":`, ultimoErro);
                continue;

            }

            salvos++;

        } catch (erro) {

            falhas++;
            ultimoErro = erro.message;
            console.error(`Erro de rede ao salvar "${produto.titulo}":`, erro);

        }

    }

    if (falhas > 0) {
        mensagemStatus.className = 'mensagemFormulario erro';
        mensagemStatus.innerHTML = `${salvos} salvo(s), <strong>${falhas} falharam</strong>. Último erro: ${ultimoErro}`;
    } else {
        mensagemStatus.className = 'mensagemFormulario sucesso';
        mensagemStatus.textContent = `${salvos} produto(s) salvo(s). Os que já tinham link de afiliado entraram ativos; os demais entraram inativos até você preencher o link.`;
    }

    if (salvos > 0) {
        produtosEncontrados = [];
        document.getElementById('resultados').innerHTML = '';
    }

}

document.getElementById('btnBuscarLink').addEventListener('click', buscarProdutosPorLink);
document.getElementById('btnBuscarArquivo').addEventListener('click', buscarProdutosPorArquivo);
document.getElementById('btnBuscarTexto').addEventListener('click', buscarProdutosPorTexto);

mudarAba('link');