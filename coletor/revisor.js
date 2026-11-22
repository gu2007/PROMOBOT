// ======= REVISOR DE PRODUTOS (Mercado Livre) =======
// Roda NO SEU PC, no mesmo Chrome do robô do coletor (porta 9222).
// Abre a página de cada produto do catálogo, lê o preço/desconto/disponibilidade
// de verdade e manda o resultado ao servidor, que arruma o catálogo sozinho
// (desativa o que saiu do ar ou perdeu a promoção, corrige preço, reativa o que voltou).
// Não usa IA e não precisa estar logado (lê a página pública).
//
//   Só olhar, sem mexer em nada:   node coletor\revisor.js --simular --n=5
//   Revisar de verdade (40):       node coletor\revisor.js --n=40
//   Revisar tudo, de pouco em pouco (modo contínuo, dentro da janela de horário):
//                                  node coletor\revisor.js --continuo
//
// Quem foi revisado há mais tempo (ou nunca) vem primeiro.
// Se aparecer captcha/login, o robô PARA, apita e espera VOCÊ resolver (ENTER).

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');

const CONFIG = {
  porExecucao: 40,          // produtos por execução (se não usar --n)
  janelaInicio: 8,          // só no modo --continuo
  janelaFim: 22,
  intervaloExecucaoMin: [90, 150], // descanso entre execuções no modo contínuo
  pausaMinMs: 3500,         // pausa entre produtos
  pausaMaxMs: 8000,
  lote: 10,                 // envia ao servidor a cada N produtos lidos
  descontoMin: 30,          // só usado na prévia do --simular (o servidor decide de verdade)
  descontoMax: 70,
};
const SERVIDOR = {
  host: 'ubuntu@163.176.135.189',
  chave: 'C:\\GUSTAVO\\SSH\\ssh-key-2026-07-14.key',
  pasta: '~/PROMOBOT',
};

const PASTA = __dirname;
const LISTA_SERVIDOR = path.join(PASTA, 'products-servidor.json');
const LOTES = path.join(PASTA, 'lotes-revisao');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const aleatorio = (a, b) => a + Math.random() * (b - a);
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a);

function perguntarEnter(mensagem) {
  process.stdout.write('\x07\x07\x07');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question('\n👉 ' + mensagem + '\n   (depois aperte ENTER aqui) ', () => { rl.close(); resolve(); }));
}

const precisaHumano = (url) => /\/captcha\/|\/jms\/|\/login|\/registration|account-verification/i.test(url);

function scp(origem, destino) {
  return new Promise((resolve, reject) => {
    execFile('scp', ['-i', SERVIDOR.chave, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', origem, destino],
      { timeout: 60000 }, (erro, _o, e) => (erro ? reject(new Error((e || erro.message).trim())) : resolve()));
  });
}

async function baixarLista() {
  await scp(`${SERVIDOR.host}:${SERVIDOR.pasta}/products.json`, LISTA_SERVIDOR);
  return JSON.parse(fs.readFileSync(LISTA_SERVIDOR, 'utf8').replace(/^\uFEFF/, ''));
}

async function enviarLote(itens) {
  fs.mkdirSync(LOTES, { recursive: true });
  const nome = `revisao-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const local = path.join(LOTES, nome);
  fs.writeFileSync(local, JSON.stringify(itens, null, 2));
  await scp(local, `${SERVIDOR.host}:${SERVIDOR.pasta}/revisao-entrada/${nome}`);
  return nome;
}

// Quem entra na revisão: ativos e os que o próprio revisor desativou (para poder reativar),
// só do Mercado Livre e só com o link do produto. Os mais antigos de revisar primeiro.
function escolher(lista, n, todos) {
  return lista
    .filter((p) => /mercadolivre/i.test(p.marketplace || '') && p.linkOriginal && p.linkAfiliado)
    .filter((p) => todos || p.ativo || p.desativadoPeloRevisor)
    .sort((a, b) => String(a.verificadoEm || '').localeCompare(String(b.verificadoEm || '')))
    .slice(0, n);
}

// ---------- leitura da página do produto ----------
async function lerPagina(page) {
  return page.evaluate(() => {
    const txt = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : '');
    const dinheiro = (el) => {
      if (!el) return null;
      const f = el.querySelector('.andes-money-amount__fraction');
      if (!f) return null;
      const inteiro = f.innerText.replace(/\D/g, '');
      if (!inteiro) return null;
      const c = el.querySelector('.andes-money-amount__cents');
      const cent = c ? c.innerText.replace(/\D/g, '').padEnd(2, '0').slice(0, 2) : '00';
      return Number(inteiro + '.' + cent);
    };

    let ldPreco = null;
    let ldDisp = '';
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent);
        for (const o of Array.isArray(j) ? j : [j]) {
          let of = o && o.offers;
          if (Array.isArray(of)) of = of[0];
          if (of) {
            if (of.price) ldPreco = Number(of.price);
            if (of.availability) ldDisp = String(of.availability);
          }
        }
      } catch (_) {}
    }

    const atualEl = document.querySelector('.ui-pdp-price__second-line .andes-money-amount');
    const antigoEl = document.querySelector('.ui-pdp-price__original-value');
    const corpo = document.body ? document.body.innerText : '';
    const acoes = txt(document.querySelector('.ui-pdp-actions__container'));

    return {
      url: location.href,
      host: location.hostname,
      titulo: txt(document.querySelector('h1')),
      preco: dinheiro(atualEl) || ldPreco,
      precoAntigo: dinheiro(antigoEl),
      temComprar: /comprar agora|adicionar ao carrinho/i.test(acoes),
      sinalIndisp: /publica[çc][ãa]o (pausada|finalizada)|an[úu]ncio (pausado|finalizado)|n[ãa]o est[áa] dispon[íi]vel|produto indispon[íi]vel|estoque esgotado|n[ãa]o h[áa] mais estoque|esgotado/i.test(corpo),
      ldFora: /OutOfStock|SoldOut|Discontinued/i.test(ldDisp),
    };
  });
}

function interpretar(leitura, produto) {
  const idEsperado = (String(produto.linkOriginal).match(/MLB-?U?\d+/i) || [''])[0];
  if (/^lista\./.test(leitura.host)) return { status: 'indisponivel', motivo: 'redirecionou para a lista' };
  if (!/mercadolivre\.com\.br$/.test(leitura.host)) return { status: 'erro', motivo: 'página inesperada: ' + leitura.url };
  if ((leitura.sinalIndisp || leitura.ldFora) && !leitura.temComprar) return { status: 'indisponivel', motivo: 'aviso de indisponível' };
  if (!leitura.preco) return { status: 'erro', motivo: 'não achei o preço' };
  return { status: 'ok', preco: leitura.preco, precoAntigo: leitura.precoAntigo || null };
}

// Prévia do que o servidor vai fazer (só para o --simular)
function previa(produto, r) {
  if (r.status === 'erro') return 'sem leitura (nada muda)';
  if (r.status === 'indisponivel') return produto.ativo ? 'DESATIVAR (indisponível)' : 'continua inativo';
  const antigo = r.precoAntigo > r.preco ? r.precoAntigo : null;
  const desc = antigo ? Math.round((1 - r.preco / antigo) * 100) : 0;
  const mudouPreco = Math.abs(r.preco - Number(produto.preco)) >= 0.005;
  let acao = produto.ativo ? 'continua ativo' : 'continua inativo';
  if (!antigo || desc < CONFIG.descontoMin) acao = produto.ativo ? 'DESATIVAR (sem desconto/baixo)' : acao;
  else if (desc > CONFIG.descontoMax) acao = produto.ativo ? 'DESATIVAR (desconto suspeito)' : acao;
  else if (!produto.ativo && produto.desativadoPeloRevisor) acao = 'REATIVAR';
  return `${mudouPreco ? `preço R$ ${produto.preco} -> R$ ${r.preco}; ` : 'preço igual; '}desconto ${desc}% | ${acao}`;
}

async function abrir(page, url) {
  for (let t = 0; t < 4; t++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await esperar(2500);
    if (!precisaHumano(page.url())) return true;
    if (/captcha/i.test(page.url())) {
      await esperar(8000);
      if (!/captcha/i.test(page.url())) continue;
    }
    await perguntarEnter('O Mercado Livre pediu verificação/login. Resolva na janela do Chrome.');
  }
  return false;
}

async function execucao(browser, n, simular, todos) {
  const lista = await baixarLista();
  const fila = escolher(lista, n, todos);
  log(`📦 ${lista.length} produtos no servidor. Vou revisar ${fila.length}${simular ? ' (SIMULAÇÃO: nada será enviado)' : ''}.`);
  if (!fila.length) return;

  const page = await browser.newPage();
  const pendentes = [];
  const total = { ok: 0, indisp: 0, erro: 0 };
  try {
    for (const p of fila) {
      log(`➡️  #${p.id} ${String(p.titulo).slice(0, 60)}`);
      let r;
      try {
        if (!(await abrir(page, p.linkOriginal))) throw new Error('não consegui abrir');
        await esperar(1200);
        r = interpretar(await lerPagina(page), p);
      } catch (e) {
        r = { status: 'erro', motivo: e.message || String(e) };
      }
      if (r.status === 'ok') total.ok++; else if (r.status === 'indisponivel') total.indisp++; else total.erro++;
      log(`   ${r.status === 'erro' ? '⚠️ ' : r.status === 'indisponivel' ? '🚫' : '✅'} ${r.status}${r.motivo ? ' (' + r.motivo + ')' : ''} ${simular ? '| ' + previa(p, r) : ''}`);

      pendentes.push({ id: p.id, linkAfiliado: p.linkAfiliado, ...r, lidoEm: new Date().toISOString() });
      if (!simular && pendentes.filter((x) => x.status !== 'erro').length >= CONFIG.lote) {
        const nome = await enviarLote(pendentes.splice(0, pendentes.length));
        log(`📤 Lote enviado (${nome}).`);
      }
      await esperar(aleatorio(CONFIG.pausaMinMs, CONFIG.pausaMaxMs));
    }
  } finally {
    await page.close().catch(() => {});
  }
  if (!simular && pendentes.length) {
    const nome = await enviarLote(pendentes);
    log(`📤 Lote final enviado (${nome}). Em até 5 min o servidor aplica.`);
  }
  log(`🏁 Fim. ok: ${total.ok} | indisponíveis: ${total.indisp} | sem leitura: ${total.erro}`);
}

(async () => {
  const continuo = process.argv.includes('--continuo');
  const simular = process.argv.includes('--simular');
  const todos = process.argv.includes('--todos');
  const argN = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1]) || CONFIG.porExecucao;

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  } catch (e) {
    console.error('❌ Não achei o Chrome do robô aberto. Abra-o com o comando Start-Process e rode de novo.');
    process.exit(1);
  }
  try {
    do {
      if (continuo) {
        while (new Date().getHours() < CONFIG.janelaInicio || new Date().getHours() >= CONFIG.janelaFim) {
          log('💤 Fora da janela de horário. Confiro de novo em 10 min.');
          await esperar(10 * 60 * 1000);
        }
      }
      try {
        await execucao(browser, argN, simular, todos);
      } catch (e) {
        log('❌ Erro nesta execução: ' + (e.message || e));
      }
      if (continuo) {
        const min = aleatorio(...CONFIG.intervaloExecucaoMin);
        log(`⏳ Descansando ${Math.round(min)} min.`);
        await esperar(min * 60 * 1000);
      }
    } while (continuo);
  } finally {
    browser.disconnect();
  }
})();
