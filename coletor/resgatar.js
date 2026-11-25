// Envia ao servidor o que o coletor já tinha juntado (resultado.json) antes de ser interrompido.
// Para não encher o grupo de um tipo só, limita furadeiras/parafusadeiras a 8.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const itens = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultado.json'), 'utf8'))
  .filter((x) => x.status === 'ok' && x.linkAfiliado);
let furadeiras = 0;
const selecionados = [];
for (const i of itens) {
  if (/furadeira|parafusadeira/i.test(i.titulo)) {
    if (furadeiras >= 8) continue;
    furadeiras++;
  }
  selecionados.push(i);
}
const nome = 'lote-resgate-' + Date.now() + '.json';
const local = path.join(__dirname, 'lotes', nome);
fs.mkdirSync(path.dirname(local), { recursive: true });
fs.writeFileSync(local, JSON.stringify(selecionados, null, 2));
execFileSync('scp', ['-i', 'C:\\GUSTAVO\\SSH\\ssh-key-2026-07-14.key', '-o', 'BatchMode=yes', local,
  'ubuntu@163.176.135.189:~/PROMOBOT/coletor-entrada/' + nome]);
console.log(`Enviados ${selecionados.length} de ${itens.length} produtos (furadeiras/parafusadeiras limitadas a 8).`);
