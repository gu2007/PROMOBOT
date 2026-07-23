let produtosEncontrados = [];

// ======================================
// Controle das abas (Link / Arquivo / Texto)
// ======================================
function mudarAba(aba) {

    document.getElementById('abaLink').style.display = aba === 'link' ? 'block' : 'none';
    document.getElementById('abaArquivo').style.display = aba === 'arquivo' ? 'block' : 'none';
    document.getElementById('abaTexto').style.display = aba === 'texto' ? 'block' : 'none';

    document.querySelectorAll('.botaoAba').forEach(botao => {
        botao.style.fontWeight = botao.dataset.aba === aba ? 'bold' : 'normal';
        botao.style.textDecoration = botao.dataset.aba === aba ? 'underline' : 'none';
    });

}

// ======================================
// Função genérica que processa a transmissão (SSE) vinda do servidor,
// usada pelas 3 formas de busca (link, arquivo, texto)
// ======================================
async function processarStream(resposta) {

    const mensagemStatus = document.getElementById('mensagemStatus');
    const areaStreaming = document.getElementById('areaStreaming');

    if (!resposta.ok || !resposta.body) {
        areaStreaming.textContent += '❌ Erro ao conectar com o servidor.\n';
        return;
    }

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

            if (tipo === 'status') {
                areaStreaming.textContent += `\nℹ️ ${dados.mensagem}\n`;
            }

            if (tipo === 'trecho') {
                areaStreaming.textContent += dados.texto;
            }

            if (tipo === 'erro') {
                areaStreaming.textContent += `\n❌ ${dados.mensagem}\n`;
                mensagemStatus.textContent = '❌ ' + dados.mensagem;
            }

            if (tipo === 'final') {
                produtosEncontrados = dados.produtos;
                mensagemStatus.textContent = `✅ ${produtosEncontrados.length} produto(s) encontrado(s). Busque o link de cada um e cole na caixinha antes de salvar.`;
                areaStreaming.textContent += '\n\n✅ Concluído!\n';
                renderizarResultados();
            }

            areaStreaming.scrollTop = areaStreaming.scrollHeight;

        }

    }

}

function prepararTelaParaBusca() {

    const mensagemStatus = document.getElementById('mensagemStatus');
    const areaStreaming = document.getElementById('areaStreaming');
    const resultados = document.getElementById('resultados');

    mensagemStatus.textContent = '';
    areaStreaming.style.display = 'block';
    areaStreaming.textContent = '⏳ Iniciando...\n';
    resultados.innerHTML = '';

}

// ======================================
// FORMA 1 — Buscar produtos por LINK
// ======================================
async function buscarProdutosPorLink() {

    const link = document.getElementById('linkPagina').value.trim();
    const mensagemStatus = document.getElementById('mensagemStatus');
    const botao = document.getElementById('btnBuscarLink');

    if (!link) {
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

        document.getElementById('areaStreaming').textContent += `\n❌ Erro de conexão: ${erro.message}\n`;
        mensagemStatus.textContent = '❌ Erro de conexão ao buscar produtos.';

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

        document.getElementById('areaStreaming').textContent += `\n❌ Erro de conexão: ${erro.message}\n`;
        mensagemStatus.textContent = '❌ Erro de conexão ao buscar produtos.';

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

        document.getElementById('areaStreaming').textContent += `\n❌ Erro de conexão: ${erro.message}\n`;
        mensagemStatus.textContent = '❌ Erro de conexão ao buscar produtos.';

    }

    botao.disabled = false;

}

// ======================================
// Monta a URL de busca mecânica (sem IA) certa pra cada marketplace
// ======================================
function montarInfoBuscaMarketplace(marketplace, titulo) {

    const termoBusca = encodeURIComponent(titulo);

    const marketplaceNormalizado = (marketplace || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');

    if (marketplaceNormalizado === 'amazon') {
        return {
            url: `https://www.amazon.com.br/s?k=${termoBusca}`,
            rotulo: 'Amazon'
        };
    }

    if (marketplaceNormalizado === 'shopee') {
        return {
            url: `https://shopee.com.br/search?keyword=${termoBusca}`,
            rotulo: 'Shopee'
        };
    }

    // Padrão: Mercado Livre (também usado se a IA não identificar o marketplace)
    return {
        url: `https://lista.mercadolivre.com.br/${termoBusca}`,
        rotulo: 'Mercado Livre'
    };

}

// ======================================
// Renderização dos resultados (igual para as 3 formas)
// ======================================
function renderizarResultados() {

    const resultados = document.getElementById('resultados');

    resultados.innerHTML = '';

    produtosEncontrados.forEach((produto, indice) => {

        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '15px';

        const infoBusca = montarInfoBuscaMarketplace(produto.marketplace, produto.titulo);

        div.innerHTML = `
            <label>
                <input type="checkbox" class="checkboxProduto" data-indice="${indice}" checked>
                <strong>${produto.titulo}</strong>
            </label>
            <p>💰 R$ ${produto.preco} ${produto.precoAntigo ? `(de R$ ${produto.precoAntigo})` : ''}</p>
            <p>📂 ${produto.categoria || 'Sem categoria'} ${produto.marca ? '· ' + produto.marca : ''}</p>
            <p>${produto.texto || ''}</p>
            <a href="${infoBusca.url}" target="_blank">
                <button type="button">🔍 Buscar produto no ${infoBusca.rotulo}</button>
            </a>
            <br><br>
            <label>Cole aqui o link encontrado:</label>
            <input type="text" class="inputLinkProduto" data-indice="${indice}" placeholder="https://..." style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #ccc;">
        `;

        resultados.appendChild(div);

    });

    if (produtosEncontrados.length > 0) {

        const botaoSalvar = document.createElement('button');
        botaoSalvar.textContent = '💾 Salvar produtos selecionados';
        botaoSalvar.id = 'btnSalvarSelecionados';
        botaoSalvar.style.marginTop = '15px';
        botaoSalvar.addEventListener('click', salvarSelecionados);
        resultados.appendChild(botaoSalvar);

    }

}

// ======================================
// Salvar os produtos selecionados (igual para as 3 formas)
// ======================================
async function salvarSelecionados() {

    const checkboxes = document.querySelectorAll('.checkboxProduto:checked');
    const mensagemStatus = document.getElementById('mensagemStatus');

    if (checkboxes.length === 0) {
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
            texto: produto.texto,
            ativo: false
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
        mensagemStatus.innerHTML = `⚠️ ${salvos} salvo(s), <strong>${falhas} falharam</strong>. Último erro: ${ultimoErro}`;
    } else {
        mensagemStatus.textContent = `✅ ${salvos} produto(s) salvo(s) como INATIVO. Vá em Produtos para revisar e ativar cada um.`;
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