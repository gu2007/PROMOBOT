const readline = require('readline');
const { adicionarProduto } = require('./produtos');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const marketplaces = {
    1: 'mercadolivre',
    2: 'shopee',
    3: 'amazon'
};

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

let marketplace = '';
let categoria = '';

function detectarMarca(titulo) {

    const marca = marcasConhecidas.find(m =>
        titulo.toLowerCase().includes(m.toLowerCase())
    );

    return marca || '';

}

function perguntarTitulo() {

    rl.question('\nTítulo:\n> ', titulo => {

        perguntarPrecoAtual(titulo);

    });

}

function perguntarPrecoAtual(titulo) {

    rl.question('\nPreço Atual:\n> ', precoAtual => {

        perguntarPrecoAntigo(
            titulo,
            Number(precoAtual.replace(',', '.'))
        );

    });

}

function perguntarPrecoAntigo(titulo, precoAtual) {

    rl.question('\nPreço Antigo (Enter se não existir):\n> ', precoAntigo => {

        if (precoAntigo.trim() === '') {

            perguntarLink(
                titulo,
                precoAtual,
                null,
                null
            );

            return;

        }

        const antigo = Number(
            precoAntigo.replace(',', '.')
        );

        const desconto = Math.round(
            ((antigo - precoAtual) / antigo) * 100
        );

        perguntarLink(
            titulo,
            precoAtual,
            antigo,
            desconto
        );

    });

}

function perguntarLink(
    titulo,
    precoAtual,
    precoAntigo,
    desconto
) {

    rl.question('\nLink de Afiliado:\n> ', link => {

        console.clear();

        console.log('═══════════════════════════════');
        console.log('RESUMO');
        console.log('═══════════════════════════════\n');

        console.log('Marketplace:', marketplace);
        console.log('Categoria :', categoria);
        console.log('Marca :', detectarMarca(titulo));
        console.log('Título :', titulo);
        console.log('Preço Atual :', precoAtual);

        if (precoAntigo)
            console.log('Preço Antigo :', precoAntigo);

        if (desconto)
            console.log('Desconto :', desconto + '%');

        console.log();

        rl.question('\nCadastrar produto? (S/N): ', resposta => {

            if (resposta.toUpperCase() !== 'S') {

                perguntarTitulo();

                return;

            }

            adicionarProduto({

                marketplace,

                categoria,

                marca: detectarMarca(titulo),

                titulo,

                preco: precoAtual,

                precoAntigo,

                desconto,

                avaliacao: null,

                vendidos: null,

                imagem: null,

                linkAfiliado: link,

                texto: ''

            });

            console.log('\n✅ Produto cadastrado!');

            rl.question('\nCadastrar outro produto? (S/N): ', r => {

                if (r.toUpperCase() === 'S') {

                    perguntarTitulo();

                } else {

                    rl.close();

                }

            });

        });

    });

}

console.clear();

console.log('═══════════════════════════════');
console.log('PROMOBOT CADASTRO');
console.log('═══════════════════════════════\n');

console.log('1 - Mercado Livre');
console.log('2 - Shopee');
console.log('3 - Amazon\n');

rl.question('Marketplace: ', resposta => {

    marketplace = marketplaces[resposta];

    rl.question('\nCategoria:\n> ', respostaCategoria => {

        categoria = respostaCategoria;

        perguntarTitulo();

    });

});