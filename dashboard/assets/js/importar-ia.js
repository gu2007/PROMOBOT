let produtosEncontrados = [];

async function buscarProdutos() {

    const link = document.getElementById('linkPagina').value.trim();
    const mensagemStatus = document.getElementById('mensagemStatus');
    const resultados = document.getElementById('resultados');
    const botao = document.getElementById('btnBuscar');

    if (!link) {
        mensagemStatus.textContent = 'Cole um link antes de buscar.';
        return;
    }

    mensagemStatus.textContent = '⏳ Buscando produtos, isso pode levar até 1 minuto...';
    resultados.innerHTML = '';
    botao.disabled = true;

    try {

        const resposta = await fetch('/api/ia/extrair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link })
        });

        const dados = await resposta.json();

        if (!dados.sucesso) {
            mensagemStatus.textContent = '❌ ' + (dados.mensagem || 'Erro ao buscar produtos.');
            botao.disabled = false;
            return;
        }

        produtosEncontrados = dados.produtos;

        mensagemStatus.textContent = `✅ ${produtosEncontrados.length} produto(s) encontrado(s). Revise antes de salvar.`;

        renderizarResultados();

    } catch (erro) {

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

        const avisoLink = produto.linkVerificado
            ? '<span style="color: green;">✅ Link verificado</span>'
            : '<span style="color: red;">🔴 Link não verificado — confira manualmente antes de ativar</span>';

        div.innerHTML = `
            <label>
                <input type="checkbox" class="checkboxProduto" data-indice="${indice}" checked>
                <strong>${produto.titulo}</strong>
            </label>
            <p>💰 R$ ${produto.preco} ${produto.precoAntigo ? `(de R$ ${produto.precoAntigo})` : ''}</p>
            <p>📂 ${produto.categoria || 'Sem categoria'} ${produto.marca ? '· ' + produto.marca : ''}</p>
            <p>${produto.texto || ''}</p>
            <p>🔗 <a href="${produto.linkOriginal}" target="_blank">${produto.linkOriginal}</a></p>
            <p>${avisoLink}</p>
            ${produto.observacao ? `<p style="color: orange;">⚠️ ${produto.observacao}</p>` : ''}
        `;

        resultados.appendChild(div);

    });

    if (produtosEncontrados.length > 0) {

        const botaoSalvar = document.createElement('button');
        botaoSalvar.textContent = '💾 Salvar produtos selecionados';
        botaoSalvar.id = 'btnSalvarSelecionados';
        botaoSalvar.addEventListener('click', salvarSelecionados);
        resultados.appendChild(botaoSalvar);

    }

}

async function salvarSelecionados() {

    const checkboxes = document.querySelectorAll('.checkboxProduto:checked');
    const mensagemStatus = document.getElementById('mensagemStatus');

    if (checkboxes.length === 0) {
        mensagemStatus.textContent = 'Selecione ao menos um produto para salvar.';
        return;
    }

    let salvos = 0;

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
            linkAfiliado: produto.linkOriginal,
            texto: produto.texto,
            ativo: false
        };

        try {

            await fetch('/api/produtos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(produtoParaSalvar)
            });

            salvos++;

        } catch (erro) {

            console.error('Erro ao salvar produto:', erro);

        }

    }

    mensagemStatus.textContent = `✅ ${salvos} produto(s) salvo(s) como INATIVO. Vá em Produtos para revisar, trocar o link pelo seu link de afiliado, e ativar cada um.`;

    produtosEncontrados = [];
    document.getElementById('resultados').innerHTML = '';

}

document.getElementById('btnBuscar').addEventListener('click', buscarProdutos);