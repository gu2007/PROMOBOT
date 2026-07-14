const fs = require('fs');
const path = require('path');

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

    const existente = produtos.find(
    p => p.linkAfiliado === produtoNovo.linkAfiliado
);

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

        produtoNovo.ativo = true;

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

    const produtos = listarProdutosAtivos();


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