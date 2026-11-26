// Padroniza as categorias do catálogo (veja categorias-padrao.js).
//   node categorizar.js            -> SÓ MOSTRA o que mudaria (não altera nada)
//   node categorizar.js --aplicar  -> aplica (faz cópia de segurança antes)
// Guarda a categoria antiga em "categoriaAntiga" para dar para desfazer.
const fs = require('fs');
const path = require('path');
const { carregarProdutos, salvarProdutos } = require('./produtos');
const { classificar } = require('./categorias-padrao');

const aplicar = process.argv.includes('--aplicar');
const produtos = carregarProdutos();

const contagem = {};
let mudam = 0;
for (const p of produtos) {
  const nova = classificar(p.titulo, p.categoria);
  contagem[nova] = (contagem[nova] || 0) + 1;
  if (p.categoria !== nova) mudam++;
}

console.log(`Produtos: ${produtos.length} | mudariam de categoria: ${mudam}\n`);
Object.entries(contagem).sort((a, b) => b[1] - a[1]).forEach(([n, q]) => console.log(String(q).padStart(4), n));

if (!aplicar) {
  console.log('\n(Simulação: nada foi alterado. Para aplicar: node categorizar.js --aplicar)');
  process.exit(0);
}

const copia = path.join(__dirname, `products.antes-categorias-${Date.now()}.json`);
fs.writeFileSync(copia, JSON.stringify(produtos, null, 2), 'utf8');
console.log(`\n💾 Cópia de segurança: ${path.basename(copia)}`);

const atuais = carregarProdutos();   // lê de novo, caso algo tenha entrado agora
for (const p of atuais) {
  const nova = classificar(p.titulo, p.categoria);
  if (p.categoria !== nova) {
    if (!p.categoriaAntiga) p.categoriaAntiga = p.categoria;
    p.categoria = nova;
  }
}
salvarProdutos(atuais);
console.log(`✅ Categorias padronizadas em ${atuais.length} produtos.`);
