const fs = require('fs');
const path = require('path');

const { adicionarProduto } = require('./produtos');

const IMPORT_PATH = path.join(__dirname, 'importar.json');

if (!fs.existsSync(IMPORT_PATH)) {
    console.log('❌ Arquivo importar.json não encontrado.');
    process.exit();
}

const produtos = JSON.parse(
    fs.readFileSync(IMPORT_PATH, 'utf8')
);

let novos = 0;
let atualizados = 0;

produtos.forEach(produto => {

    const antes = produto.id;

    adicionarProduto(produto);

    if (antes) {
        atualizados++;
    } else {
        novos++;
    }

});

console.clear();

console.log("═══════════════════════════════════════");
console.log("📥 IMPORTADOR PROMOBOT");
console.log("═══════════════════════════════════════");
console.log(`📦 Produtos lidos : ${produtos.length}`);
console.log(`➕ Importação finalizada.`);
console.log("═══════════════════════════════════════");