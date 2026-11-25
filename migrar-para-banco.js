// ======= TESTE DA MIGRAÇÃO PARA O BANCO (não mexe em nada de verdade) =======
// Cria um banco de TESTE temporário a partir do products.json atual e confere se cada
// produto ficou idêntico. O banco de verdade (promobot.db) NÃO é tocado.
//   Uso (no servidor, pasta ~/PROMOBOT):  node migrar-para-banco.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), 'promobot-teste-' + Date.now() + '.db');
process.env.PROMOBOT_TESTE = '1';
process.env.PROMOBOT_DB = tmp;

const banco = require('./banco');
const orig = JSON.parse(fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8').replace(/^﻿/, ''));
const lista = banco.lerTodos();

const mesmoTotal = lista.length === orig.length;
const iguais = JSON.stringify(lista) === JSON.stringify(orig);
const ativosJson = orig.filter((p) => p.ativo).length;
const ativosBanco = lista.filter((p) => p.ativo).length;

console.log(`Produtos no products.json: ${orig.length} (ativos ${ativosJson})`);
console.log(`Produtos no banco de teste: ${lista.length} (ativos ${ativosBanco})`);
console.log(mesmoTotal && iguais && ativosJson === ativosBanco
  ? '✅ MIGRAÇÃO OK: todos os produtos ficaram idênticos.'
  : '❌ DIFERENÇA ENCONTRADA: NÃO ligue o banco ainda e me avise.');

banco.fechar();
for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
