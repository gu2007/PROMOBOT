const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

const marcasConhecidas = [
    'Bosch',
    'Makita',
    'The Black Tools',
    'DeWalt',
    'Vonder',
    'Worker',
    'Stanley',
    'Tramontina',
    'Black+Decker',
    'Black & Decker',
    'Einhell',
    'Ingco',
    'WAP',
    'Philips',
    'Philco',
    'Mondial',
    'Britânia',
    'Electrolux',
    'Samsung',
    'LG',
    'Motorola',
    'Apple',
    'Lenovo',
    'Dell',
    'Asus',
    'Acer',
    'Kingston',
    'Sandisk',
    'TP-Link',
    'Intelbras',
    'Logitech',
    'HyperX',
    'Redragon',
    'Corsair'
];

const PRODUCTS_PATH = path.join(__dirname, 'products.json');

// A partir daqui: com quanto de "parecido" (0 a 1) dois títulos já contam como suspeitos,
// e qual a diferença de preço máxima aceitável (0.15 = 15%) para reforçar a suspeita.
const SIMILARIDADE_MINIMA_TITULO = 0.5;
const TOLERANCIA_PRECO = 0.15;

function normalizarTitulo(titulo) {

    return (titulo || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

}

function calcularSimilaridadeTitulos(tituloA, tituloB) {

    const palavrasA = new Set(
        normalizarTitulo(tituloA).split(' ').filter(palavra => palavra.length >= 3)
    );

    const palavrasB = new Set(
        normalizarTitulo(tituloB).split(' ').filter(palavra => palavra.length >= 3)
    );

    if (palavrasA.size === 0 || palavrasB.size === 0) return 0;

    let palavrasEmComum = 0;

    palavrasA.forEach(palavra => {
        if (palavrasB.has(palavra)) palavrasEmComum++;
    });

    const totalPalavrasUnicas = new Set([...palavrasA, ...palavrasB]).size;

    return palavrasEmComum / totalPalavrasUnicas;

}

function precosSaoProximos(precoA, precoB) {

    if (typeof precoA !== 'number' || typeof precoB !== 'number') return false;
    if (precoA <= 0 || precoB <= 0) return false;

    const diferenca = Math.abs(precoA - precoB) / Math.max(precoA, precoB);

    return diferenca <= TOLERANCIA_PRECO;

}

// Procura, entre os produtos já cadastrados NO MESMO MARKETPLACE, algum com título
// muito parecido e preço próximo do produto novo. Se achar, retorna esse produto
// (o "original" suspeito); se não achar nada parecido o suficiente, retorna null.
function normalizarMarketplace(marketplace) {

    return (marketplace || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');

}

function encontrarDuplicataSuspeita(produtoNovo, produtosExistentes) {

    const marketplaceNovo = normalizarMarketplace(produtoNovo.marketplace);

    const candidatos = produtosExistentes.filter(
        p => normalizarMarketplace(p.marketplace) === marketplaceNovo
    );

    for (const candidato of candidatos) {

        const similaridade = calcularSimilaridadeTitulos(produtoNovo.titulo, candidato.titulo);

        if (similaridade >= SIMILARIDADE_MINIMA_TITULO && precosSaoProximos(produtoNovo.preco, candidato.preco)) {
            return candidato;
        }

    }

    return null;

}

// ======================================
// Um produto só conta como "com desconto real" se tiver um preço antigo
// preenchido E esse preço antigo for de fato maior que o preço atual. Sem
// isso, não é uma promoção de verdade — só um preço normal, e por isso o
// produto não deve ficar ativo (nem ser mandado pro grupo).
// ======================================
function produtoSemDescontoReal(produto) {

    const precoAntigo = Number(produto.precoAntigo);
    const preco = Number(produto.preco);

    if (!precoAntigo || isNaN(precoAntigo)) return true;
    if (isNaN(preco)) return true;
    if (precoAntigo <= preco) return true;

    return false;

}

function carregarProdutos() {
    if (!fs.existsSync(PRODUCTS_PATH)) return [];

    return JSON.parse(
        fs.readFileSync(PRODUCTS_PATH, 'utf8')
    );
}

function salvarProdutos(produtos) {
    fs.writeFileSync(
        PRODUCTS_PATH,
        JSON.stringify(produtos, null, 2)
    );
}

function listarProdutos() {
    return carregarProdutos();
}

function adicionarProduto(produtoNovo) {

    const produtos = carregarProdutos();

    const linkValido = produtoNovo.linkAfiliado && produtoNovo.linkAfiliado !== 'LINK_NAO_CONFIRMADO';

    const existente = linkValido
        ? produtos.find(p => p.linkAfiliado === produtoNovo.linkAfiliado)
        : null;

    if (existente) {

        Object.assign(existente, produtoNovo);

        existente.id = existente.id;

        existente.enviado = existente.enviado || 0;

        existente.criadoEm = existente.criadoEm;

        existente.atualizadoEm = new Date().toISOString();

        // Nunca deixa ativo um produto sem desconto real, mesmo numa atualização
        if (produtoSemDescontoReal(existente)) {
            existente.ativo = false;
        }

    } else {

        produtoNovo.id =
            produtos.length > 0
                ? Math.max(...produtos.map(p => p.id)) + 1
                : 1;

        produtoNovo.enviado = 0;

        produtoNovo.ultimaDivulgacao = null;

        produtoNovo.criadoEm = new Date().toISOString();

        produtoNovo.atualizadoEm = null;

        produtoNovo.ativo = typeof produtoNovo.ativo === 'boolean' ? produtoNovo.ativo : true;

        const duplicataSuspeita = encontrarDuplicataSuspeita(produtoNovo, produtos);

        if (duplicataSuspeita) {

            produtoNovo.duplicataSuspeita = true;
            produtoNovo.duplicataDeId = duplicataSuspeita.id;

            // Trava a divulgação até você revisar manualmente na aba de Duplicados,
            // evitando mandar pro grupo um produto que pode ser repetido.
            produtoNovo.ativo = false;

        } else {

            produtoNovo.duplicataSuspeita = false;
            produtoNovo.duplicataDeId = null;

        }

        // Nunca deixa ativo um produto sem desconto real (preço antigo
        // ausente ou não maior que o preço atual) — isso tem prioridade
        // sobre qualquer outra decisão de ativação.
        if (produtoSemDescontoReal(produtoNovo)) {
            produtoNovo.ativo = false;
        }

        produtos.push(produtoNovo);

    }

    salvarProdutos(produtos);

    return existente || produtoNovo;

}

function listarProdutosAtivos() {
    return carregarProdutos().filter(p => p.ativo);
}

function totalProdutos() {
    return carregarProdutos().length;
}

function totalProdutosAtivos() {
    return listarProdutosAtivos().length;
}

function totalCategorias() {

    const categorias = carregarProdutos().map(p => p.categoria);

    return [...new Set(categorias)].length;

}

function buscarProduto(id) {

    id = Number(id);

    return carregarProdutos().find(produto => produto.id === id);

}

// Embaralha um array no lugar (Fisher-Yates), sem viés de posição.
function embaralhar(lista) {
    for (let i = lista.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lista[i], lista[j]] = [lista[j], lista[i]];
    }
    return lista;
}

function proximoProduto() {

    let intervaloHoras = 24;

    if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        if (typeof config.intervaloRepeticaoHoras === 'number') {
            intervaloHoras = config.intervaloRepeticaoHoras;
        }
    }

    const agora = Date.now();

    const produtos = listarProdutosAtivos().filter(p => {
        if (!p.ultimaDivulgacao) return true;
        const horasDesdeEnvio = (agora - new Date(p.ultimaDivulgacao).getTime()) / (1000 * 60 * 60);
        return horasDesdeEnvio >= intervaloHoras;
    });

    if (produtos.length === 0) return null;

    // Prioridade continua sendo quem foi menos enviado (fairness/rotação) —
    // isso é o que garante que todo produto tenha sua vez. A mudança é que,
    // dentro do grupo de "quem foi enviado o mesmo número de vezes", a
    // escolha agora é ALEATÓRIA em vez de seguir a ordem de cadastro (id)
    // ou a data da última divulgação. Isso evita que produtos da mesma
    // marca (cadastrados em sequência) saiam um atrás do outro.
    const menorEnviado = Math.min(...produtos.map(p => p.enviado || 0));
    const candidatos = produtos.filter(p => (p.enviado || 0) === menorEnviado);

    embaralhar(candidatos);

    const escolhido = candidatos[0];

    const todos = carregarProdutos();

    const produtoReal = todos.find(p => p.id === escolhido.id);

    produtoReal.enviado++;

    produtoReal.ultimaDivulgacao = new Date().toISOString();

    salvarProdutos(todos);

    return produtoReal;

}

// Diferença mínima de preço (10%) pra considerar que "mudou de verdade" e
// vale a pena atualizar sozinho + avisar você, evitando ruído por centavos
// de arredondamento.
const TOLERANCIA_MUDANCA_PRECO = 0.10;

// Acima disso (30%), a diferença é grande demais pra confiar cegamente na
// leitura da IA — é mais provável ser erro de leitura (preço parcelado,
// variação errada, produto errado) do que uma promoção real. Nesses casos,
// o sistema NÃO aplica sozinho: só sugere, e espera sua confirmação manual.
const TOLERANCIA_SUGESTAO_MAXIMA = 0.30;

// Aplica o resultado da verificação de um produto:
// - se ficou indisponível: desativa o produto e marca pra revisão
// - se o preço mudou pouco (10%-30%): atualiza sozinho e marca pra revisão
// - se o preço mudou MUITO (acima de 30%): NÃO mexe no preço, só guarda a
//   sugestão pra você aprovar manualmente (evita aplicar sozinho um possível
//   erro grande de leitura da IA)
// - se a IA encontrou uma foto do produto e ainda não tínhamos: salva ela,
//   sem gerar alerta na aba de revisão (não é uma "alteração" que precisa de
//   atenção, é só um dado que estava faltando)
// - se nada disso: não mexe em nada
function aplicarResultadoVerificacao(id, resultado) {

    const produtos = carregarProdutos();

    const produto = produtos.find(p => p.id === Number(id));

    if (!produto) return;

    let houveMudancaSilenciosa = false;

    if (
        resultado.imagemUrl &&
        typeof resultado.imagemUrl === 'string' &&
        resultado.imagemUrl.startsWith('http') &&
        produto.imagem !== resultado.imagemUrl
    ) {
        produto.imagem = resultado.imagemUrl;
        houveMudancaSilenciosa = true;
    }

    if (resultado.disponivel === false) {

        produto.ativo = false;
        produto.alteracaoDetectada = true;
        produto.tipoAlteracao = 'indisponivel';
        produto.dataVerificacao = new Date().toISOString();

        salvarProdutos(produtos);
        return;

    }

    if (typeof resultado.preco === 'number' && resultado.preco > 0) {

        const precoAtual = produto.preco;
        const diferenca = Math.abs(resultado.preco - precoAtual) / Math.max(resultado.preco, precoAtual);

        if (diferenca > TOLERANCIA_SUGESTAO_MAXIMA) {

            // Diferença grande demais: guarda como sugestão, NÃO aplica sozinho
            produto.precoSugerido = resultado.preco;
            produto.alteracaoDetectada = true;
            produto.tipoAlteracao = 'preco_sugerido';
            produto.dataVerificacao = new Date().toISOString();

            salvarProdutos(produtos);
            return;

        }

        if (diferenca >= TOLERANCIA_MUDANCA_PRECO) {

            // Diferença dentro da faixa confiável: aplica sozinho
            produto.precoAnterior = precoAtual;
            produto.preco = resultado.preco;
            produto.alteracaoDetectada = true;
            produto.tipoAlteracao = 'preco';
            produto.dataVerificacao = new Date().toISOString();

            salvarProdutos(produtos);
            return;

        }

    }

    if (houveMudancaSilenciosa) {
        salvarProdutos(produtos);
    }

}

function listarAlteracoesDetectadas() {
    return carregarProdutos().filter(p => p.alteracaoDetectada);
}

module.exports = {

    carregarProdutos,
    salvarProdutos,

    listarProdutos,
    listarProdutosAtivos,

    totalProdutos,
    totalProdutosAtivos,
    totalCategorias,

    buscarProduto,

    adicionarProduto,

    produtoSemDescontoReal,

    proximoProduto,

    aplicarResultadoVerificacao,
    listarAlteracoesDetectadas,

    // Exportadas pra serem reaproveitadas pelo buscador automático de produto
    // no Mercado Livre (resolvedorAfiliado.js), em vez de duplicar a lógica
    // de comparação de título/preço em dois lugares.
    calcularSimilaridadeTitulos,
    precosSaoProximos

};