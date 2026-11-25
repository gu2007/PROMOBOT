// ======= BANCO DE DADOS DOS PRODUTOS (SQLite) =======
// Substitui o products.json como "fonte da verdade". O SQLite é um banco que fica
// num único arquivo (promobot.db), sem programa separado para instalar. Usa o módulo
// que já vem dentro do Node (node:sqlite).
//
// Como funciona (leia com calma, é para estudar):
//  - Tabela "produtos": uma linha por produto. Guarda o produto inteiro como JSON na
//    coluna "dados" (assim todo o código antigo continua igual) e, ao lado, algumas
//    colunas soltas (ativo, categoria, preço...) para consultas rápidas no futuro.
//  - Tabela "historico_precos": cada vez que o preço de um produto muda, guarda uma linha.
//  - Tabela "envios": cada oferta enviada ao grupo vira uma linha.
//  - Salvar é ATÔMICO (transação): ou grava tudo, ou nada. Acabou o risco de arquivo cortado.
//  - Ao salvar, só as linhas que MUDARAM são gravadas. Assim, se dois processos mexerem
//    em produtos diferentes ao mesmo tempo, um não apaga a alteração do outro.
//  - O products.json continua sendo gerado, só como ESPELHO para leitura (o coletor e o
//    revisor baixam esse arquivo). Não edite o espelho: ele é sobrescrito.
//  - Todo dia faz uma cópia de segurança do banco na pasta backups-banco/ (guarda as últimas 10).
const fs = require('fs');
const path = require('path');

const TESTE = process.env.PROMOBOT_TESTE === '1';
const DB_PATH = process.env.PROMOBOT_DB || path.join(__dirname, 'promobot.db');
const JSON_PATH = path.join(__dirname, 'products.json');
const PASTA_BACKUP = path.join(__dirname, 'backups-banco');

let db = null;
const snapshots = new WeakMap(); // lista carregada -> (id -> texto do produto quando foi lido)
let espelhoAgendado = null;

function transacao(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
}

function abrir() {
  if (db) return db;
  const { DatabaseSync } = require('node:sqlite'); // só carrega quando o banco é usado
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 8000; PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY,
      ativo INTEGER NOT NULL DEFAULT 0,
      marketplace TEXT,
      categoria TEXT,
      titulo TEXT,
      preco REAL,
      link_afiliado TEXT,
      dados TEXT NOT NULL,
      atualizado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_produtos_ativo ON produtos(ativo);
    CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos(categoria);
    CREATE INDEX IF NOT EXISTS idx_produtos_link ON produtos(link_afiliado);
    CREATE TABLE IF NOT EXISTS historico_precos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      preco REAL,
      preco_antigo REAL,
      em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hist_produto ON historico_precos(produto_id, em);
    CREATE TABLE IF NOT EXISTS envios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_envios_produto ON envios(produto_id, em);
    CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT);
  `);
  migrarSeNecessario();
  if (!TESTE) agendarBackup();
  return db;
}

// Primeira vez que o banco abre: copia tudo do products.json (uma vez só).
function migrarSeNecessario() {
  const feito = db.prepare("SELECT valor FROM meta WHERE chave = 'migrado_em'").get();
  if (feito) return;
  let lista = [];
  if (fs.existsSync(JSON_PATH)) {
    lista = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8').replace(/^﻿/, ''));
    if (!TESTE) {
      try { fs.copyFileSync(JSON_PATH, JSON_PATH.replace(/\.json$/, '.pre-banco.json')); } catch (_) {}
    }
  }
  transacao(() => {
    db.exec('DELETE FROM produtos');
    for (const p of lista) gravarLinha(p, true, null); // já guarda o preço inicial no histórico
    db.prepare("INSERT OR REPLACE INTO meta(chave, valor) VALUES ('migrado_em', ?)").run(new Date().toISOString());
  });
  console.log(`🗄️  Banco de dados criado: ${lista.length} produto(s) copiados do products.json.`);
}

function gravarLinha(p, comHistorico, anterior) {
  const id = Number(p.id);
  const texto = JSON.stringify(p);
  db.prepare(`
    INSERT INTO produtos (id, ativo, marketplace, categoria, titulo, preco, link_afiliado, dados, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET ativo = excluded.ativo, marketplace = excluded.marketplace,
      categoria = excluded.categoria, titulo = excluded.titulo, preco = excluded.preco,
      link_afiliado = excluded.link_afiliado, dados = excluded.dados, atualizado_em = excluded.atualizado_em
  `).run(id, p.ativo ? 1 : 0, p.marketplace || null, p.categoria || null, p.titulo || null,
    Number.isFinite(Number(p.preco)) ? Number(p.preco) : null, p.linkAfiliado || null, texto, new Date().toISOString());
  if (comHistorico) {
    const mudouPreco = !anterior || Number(anterior.preco) !== Number(p.preco) || Number(anterior.precoAntigo || 0) !== Number(p.precoAntigo || 0);
    if (mudouPreco && Number(p.preco) > 0) {
      db.prepare('INSERT INTO historico_precos (produto_id, preco, preco_antigo, em) VALUES (?, ?, ?, ?)')
        .run(id, Number(p.preco), Number(p.precoAntigo) || null, new Date().toISOString());
    }
  }
  return texto;
}

// Lê todos os produtos (mesmo formato de antes: uma lista de objetos).
function lerTodos() {
  abrir();
  const linhas = db.prepare('SELECT id, dados FROM produtos ORDER BY id').all();
  const lista = linhas.map((l) => JSON.parse(l.dados));
  snapshots.set(lista, new Map(linhas.map((l) => [l.id, l.dados])));
  return lista;
}

// Salva a lista. Só grava o que mudou desde que a lista foi lida; apaga o que sumiu da lista.
function salvarTodos(lista) {
  abrir();
  let mudou = false;
  const snap = snapshots.get(lista);
  transacao(() => {
    let base = snap;
    if (!base) { // lista que não veio de lerTodos(): compara com o que está no banco agora
      base = new Map(db.prepare('SELECT id, dados FROM produtos').all().map((l) => [l.id, l.dados]));
    }
    const vistos = new Set();
    for (const p of lista) {
      if (!p || p.id === undefined || p.id === null) continue;
      const id = Number(p.id);
      vistos.add(id);
      const novo = JSON.stringify(p);
      const antes = base.get(id);
      if (antes === novo) continue;
      const texto = gravarLinha(p, true, antes ? JSON.parse(antes) : null);
      if (snap) snap.set(id, texto);
      mudou = true;
    }
    for (const id of [...base.keys()]) {
      if (vistos.has(id)) continue;
      db.prepare('DELETE FROM produtos WHERE id = ?').run(id);
      if (snap) snap.delete(id);
      mudou = true;
    }
  });
  if (mudou) agendarEspelho();
  return mudou;
}

function registrarEnvio(produtoId) {
  abrir();
  db.prepare('INSERT INTO envios (produto_id, em) VALUES (?, ?)').run(Number(produtoId), new Date().toISOString());
}

// ---------- espelho em products.json (só leitura) ----------
function agendarEspelho() {
  if (TESTE || espelhoAgendado) return;
  espelhoAgendado = setTimeout(() => {
    espelhoAgendado = null;
    try { exportarEspelho(); } catch (e) { console.error('⚠️ Não consegui atualizar o espelho products.json:', e.message); }
  }, 2000);
  if (espelhoAgendado.unref) espelhoAgendado.unref();
}

function exportarEspelho() {
  abrir();
  const lista = db.prepare('SELECT dados FROM produtos ORDER BY id').all().map((l) => JSON.parse(l.dados));
  const tmp = JSON_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2));
  fs.renameSync(tmp, JSON_PATH);
}

// ---------- cópia de segurança diária ----------
function agendarBackup() {
  const fazer = () => {
    try {
      fs.mkdirSync(PASTA_BACKUP, { recursive: true });
      const dia = new Date().toISOString().slice(0, 10);
      const destino = path.join(PASTA_BACKUP, `promobot-${dia}.db`);
      if (!fs.existsSync(destino)) {
        db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
        console.log(`🗄️  Cópia de segurança do banco: ${destino}`);
      }
      const antigos = fs.readdirSync(PASTA_BACKUP).filter((f) => /^promobot-.*\.db$/.test(f)).sort().slice(0, -10);
      for (const f of antigos) fs.unlinkSync(path.join(PASTA_BACKUP, f));
    } catch (e) {
      console.error('⚠️ Cópia de segurança do banco falhou:', e.message);
    }
  };
  setTimeout(fazer, 15 * 1000).unref();
  setInterval(fazer, 6 * 60 * 60 * 1000).unref();
}

function fechar() {
  if (espelhoAgendado) { clearTimeout(espelhoAgendado); espelhoAgendado = null; }
  if (db) { db.close(); db = null; }
}

module.exports = { abrir, lerTodos, salvarTodos, registrarEnvio, exportarEspelho, fechar };
