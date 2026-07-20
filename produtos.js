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
function encontrarDuplicataSuspeita(produtoNovo, produtosExistentes) {

    const candidatos = produtosExistentes.filter(
        p => p.marketplace === produtoNovo.marketplace
    );

    for (const candidato of candidatos) {

        const similaridade = calcularSimilaridadeTitulos(produtoNovo.titulo, candidato.titulo);

        if (similaridade >= SIMILARIDADE_MINIMA_TITULO && precosSaoProximos(produtoNovo.preco, candidato.preco)) {
            return candidato;
        }

    }

    return null;

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

        produtos.push(produtoNovo);

    }

    salvarProdutos(produtos);

    return "atualizado";

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

    produtos.sort((a, b) => {

        const enviadosA = a.enviado || 0;
        const enviadosB = b.enviado || 0;

        if (enviadosA !== enviadosB)
            return enviadosA - enviadosB;

        const dataA = a.ultimaDivulgacao
            ? new Date(a.ultimaDivulgacao)
            : new Date(0);

        const dataB = b.ultimaDivulgacao
            ? new Date(b.ultimaDivulgacao)
            : new Date(0);

        return dataA - dataB;

    });

    const escolhido = produtos[0];

    const todos = carregarProdutos();

    const produtoReal = todos.find(p => p.id === escolhido.id);

    produtoReal.enviado++;

    produtoReal.ultimaDivulgacao = new Date().toISOString();

    salvarProdutos(todos);

    return produtoReal;

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

    proximoProduto

};