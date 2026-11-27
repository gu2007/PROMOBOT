// Remove do catálogo os produtos que o REVISOR desativou por uma destas regras:
//   desconto-baixo (abaixo do mínimo), sem-desconto, indisponivel.
// Não mexe em: desconto-suspeito, duplicatas, produtos inativos por outras causas,
// nem em nenhum produto ATIVO.
//   node limpar-catalogo.js           -> SÓ LISTA o que seria apagado
//   node limpar-catalogo.js --apagar  -> apaga (cópia de segurança completa antes)
const fs = require('fs');
const path = require('path');
const { carregarProdutos, salvarProdutos } = require('./produtos');

const MOTIVOS = new Set(['desconto-baixo', 'sem-desconto', 'indisponivel']);
const apagar = process.argv.includes('--apagar');

const todos = carregarProdutos();
const alvo = todos.filter((p) => !p.ativo && p.desativadoPeloRevisor && MOTIVOS.has(p.revisorMotivo));

const porMotivo = {};
alvo.forEach((p) => { porMotivo[p.revisorMotivo] = (porMotivo[p.revisorMotivo] || 0) + 1; });

console.log(`Catálogo: ${todos.length} produtos (${todos.filter((p) => p.ativo).length} ativos)`);
console.log(`Seriam apagados: ${alvo.length}`);
Object.entries(porMotivo).forEach(([m, q]) => console.log(`  ${String(q).padStart(4)}  ${m}`));
console.log(`Ficariam: ${todos.length - alvo.length} (${todos.filter((p) => p.ativo).length} ativos, ${todos.length - alvo.length - todos.filter((p) => p.ativo).length} inativos)`);

if (!apagar) {
  console.log('\n(Simulação: nada foi apagado. Para apagar: node limpar-catalogo.js --apagar)');
  process.exit(0);
}

const marca = Date.now();
const copia = path.join(__dirname, `products.antes-limpeza-${marca}.json`);
const lista = path.join(__dirname, `removidos-${marca}.json`);
fs.writeFileSync(copia, JSON.stringify(todos, null, 2), 'utf8');
fs.writeFileSync(lista, JSON.stringify(alvo, null, 2), 'utf8');
console.log(`\n💾 Cópia completa: ${path.basename(copia)}`);
console.log(`💾 Lista dos removidos: ${path.basename(lista)}`);

// Relê agora (algo pode ter mudado nos últimos segundos) e remove só quem ainda se encaixa.
const ids = new Set(alvo.map((p) => p.id));
const atuais = carregarProdutos();
const restantes = atuais.filter((p) => !(ids.has(p.id) && !p.ativo && p.desativadoPeloRevisor && MOTIVOS.has(p.revisorMotivo)));
const removidos = atuais.length - restantes.length;
salvarProdutos(restantes);
console.log(`✅ Apagados ${removidos} produtos. Catálogo agora: ${restantes.length}.`);
