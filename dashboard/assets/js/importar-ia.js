let produtosEncontrados = [];

async function buscarProdutos() {

    const link = document.getElementById('linkPagina').value.trim();
    const mensagemStatus = document.getElementById('mensagemStatus');
    const areaStreaming = document.getElementById('areaStreaming');
    const resultados = document.getElementById('resultados');
    const botao = document.getElementById('btnBuscar');

    if (!link) {
        mensagemStatus.textContent = 'Cole um link antes de buscar.';
        return;
    }

    mensagemStatus.textContent = '';
    areaStreaming.style.display = 'block';
    areaStreaming.textContent = '⏳ Iniciando...\n';
    resultados.innerHTML = '';
    botao.disabled = true;

    try {

        const resposta = await fetch('/api/ia/extrair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link })
        });

        if (!resposta.ok || !resposta.body) {
            areaStreaming.textContent += '❌ Erro ao conectar com o servidor.\n';
            botao.disabled = false;
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
                    mensagemStatus.textContent = `✅ ${produtosEncontrados.length} produto(s) encontrado(s). Selecione quais quer buscar o link, depois marque para salvar.`;
                    areaStreaming.textContent += '\n\n✅ Concluído! Agora selecione os produtos e clique em "Buscar links".\n';
                    renderizarResultados();
                }

                areaStreaming.scrollTop = areaStreaming.scrollHeight;

            }

        }

    } catch (erro) {

        areaStreaming.textContent += `\n❌ Erro de conexão: ${erro.message}\n`;
        mensagemStatus.textContent = '❌ Erro de conexão ao buscar produtos.';

    }

    botao.disabled = false;

}

function renderizarResultados() {

    const resultados = document.getElementById('resultados');

    resultados.innerHTML = '';

    produtosEncontrados.forEach((produto, indice) => {

        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '15px';
        div.id = `produto-card-${indice}`;

        div.innerHTML = renderizarConteudoCartao(produto, indice);

        resultados.appendChild(div);

    });

    if (produtosEncontrados.length > 0) {

        const botaoBuscarLinks = document.createElement('button');
        botaoBuscarLinks.textContent = '🔗 Buscar links dos selecionados';
        botaoBuscarLinks.id = 'btnBuscarLinks';
        botaoBuscarLinks.addEventListener('click', buscarLinksSelecionados);
        resultados.appendChild(botaoBuscarLinks);

        const botaoSalvar = document.createElement('button');
        botaoSalvar.textContent = '💾 Salvar produtos selecionados';
        botaoSalvar.id = 'btnSalvarSelecionados';
        botaoSalvar.style.marginLeft = '10px';
        botaoSalvar.addEventListener('click', salvarSelecionados);
        resultados.appendChild(botaoSalvar);

    }

}

function renderizarConteudoCartao(produto, indice) {

    let statusLink;

    if (!produto.linkOriginal) {
        statusLink = '<span style="color: #999;">⏳ Link ainda não buscado</span>';
    } else if (produto.linkOriginal === 'LINK_NAO_CONFIRMADO') {
        statusLink = '<span style="color: red;">🔴 A IA não encontrou o link deste produto com confiança. Busque manualmente pelo título.</span>';
    } else if (produto.linkVerificado) {
        statusLink = `<span style="color: green;">✅ Link verificado: <a href="${produto.linkOriginal}" target="_blank">abrir</a></span>`;
    } else {
        statusLink = `<span style="color: red;">🔴 Link encontrado mas não verificado (pode estar quebrado) — <a href="${produto.linkOriginal}" target="_blank">abrir mesmo assim</a></span>`;
    }

    return `
        <label>
            <input type="checkbox" class="checkboxProduto" data-indice="${indice}" checked>
            <strong>${produto.titulo}</strong>
        </label>
        <p>💰 R$ ${produto.preco} ${produto.precoAntigo ? `(de R$ ${produto.precoAntigo})` : ''}</p>
        <p>📂 ${produto.categoria || 'Sem categoria'} ${produto.marca ? '· ' + produto.marca : ''}</p>
        <p>${produto.texto || ''}</p>
        <p id="statusLink-${indice}">${statusLink}</p>
    `;

}

async function buscarLinksSelecionados() {

    const checkboxes = document.querySelectorAll('.checkboxProduto:checked');
    const mensagemStatus = document.getElementById('mensagemStatus');
    const botao = document.getElementById('btnBuscarLinks');

    if (checkboxes.length === 0) {
        mensagemStatus.textContent = 'Selecione ao menos um produto para buscar o link.';
        return;
    }

    botao.disabled = true;

    let indice = 0;

    for (const checkbox of checkboxes) {

        indice++;

        const idx = Number(checkbox.dataset.indice);
        const produto = produtosEncontrados[idx];

        mensagemStatus.textContent = `🔍 Buscando link ${indice}/${checkboxes.length}: ${produto.titulo.substring(0, 40)}...`;

        try {

            const resposta = await fetch('/api/ia/buscar-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    titulo: produto.titulo,
                    marca: produto.marca,
                    preco: produto.preco,
                    marketplace: produto.marketplace
                })
            });

            const dados = await resposta.json();

            if (dados.sucesso) {
                produto.linkOriginal = dados.link;
                produto.linkVerificado = dados.linkVerificado;
            }

        } catch (erro) {

            console.error(`Erro ao buscar link do produto "${produto.titulo}":`, erro);

        }

        const cardAtual = document.getElementById(`produto-card-${idx}`);
        if (cardAtual) {
            cardAtual.innerHTML = renderizarConteudoCartao(produto, idx);
        }

    }

    mensagemStatus.textContent = `✅ Busca de links concluída para ${checkboxes.length} produto(s).`;

    botao.disabled = false;

}

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
            linkAfiliado: produto.linkOriginal || 'LINK_NAO_CONFIRMADO',
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
        mensagemStatus.textContent = `✅ ${salvos} produto(s) salvo(s) como INATIVO. Vá em Produtos para revisar, trocar o link pelo seu link de afiliado, e ativar cada um.`;
    }

    if (salvos > 0) {
        produtosEncontrados = [];
        document.getElementById('resultados').innerHTML = '';
    }

}

document.getElementById('btnBuscar').addEventListener('click', buscarProdutos);
