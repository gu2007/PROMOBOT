// ======= COLETOR DE PRODUTOS (Mercado Livre) — versão contínua =======
// Roda NO SEU PC. Conecta ao Chrome do robô (aberto por você e logado na conta
// de afiliado), busca produtos em promoção do seu nicho, gera o link de afiliado
// de cada um e ENVIA o resultado sozinho ao servidor (por SSH). O PROMOBOT, no
// servidor, cadastra os produtos (e ativa, se "coletorAutoAtivar" estiver ligado).
//
// Uma rodada só (teste):        node coletor\coletor.js --n=5
// Trabalhar o dia todo (ciclos):  node coletor\coletor.js --continuo
//
// Se aparecer captcha/login, o robô PARA, apita e espera VOCÊ resolver na janela
// do Chrome (depois aperte ENTER aqui). Ele nunca tenta burlar captcha.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');

// ---------- AJUSTES ----------
const CONFIG = {
  buscas: [
    'ferramentas-automotivas', 'chave-de-impacto', 'jogo-de-ferramentas', 'compressor-de-ar',
    'politriz-automotiva', 'esmerilhadeira', 'parafusadeira', 'furadeira', 'macaco-hidraulico',
    'carregador-de-bateria-automotivo', 'lavadora-de-alta-pressao', 'kit-soquetes',
    'alicate', 'torquimetro', 'multimetro-automotivo', 'aspirador-automotivo',
  ],
  paginasMax: 5,            // sorteia a página de 1 a 5 de cada busca (48 produtos por página)
  descontoMin: 30,          // % mínimo de desconto
  avaliacaoMin: 4.3,        // ignora produtos com nota menor (se tiver nota)
  porRodada: 15,            // produtos novos por rodada
  tetoDiario: 60,           // máximo de produtos novos por dia (proteção da sua conta)
  janelaInicio: 8,          // só trabalha entre estas horas (modo --continuo)
  janelaFim: 22,
  intervaloRodadaMin: [60, 120], // minutos de descanso entre rodadas (sorteado)
  pausaMinMs: 4000,         // pausa entre ações (ritmo humano)
  pausaMaxMs: 9000,
};
const SERVIDOR = {
  host: 'ubuntu@163.176.135.189',
  chave: 'C:\\GUSTAVO\\SSH\\ssh-key-2026-07-14.key',
  pasta: '~/PROMOBOT',
};
// -----------------------------

const PASTA = __dirname;
const SAIDA = path.join(PASTA, 'resultado.json');
const ESTADO = path.join(PASTA, 'estado.json');
const LISTA_SERVIDOR = path.join(PASTA, 'products-servidor.json');
const LOTES = path.join(PASTA, 'lotes');
const URL_PAINEL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const aleatorio = (a, b) => a + Math.random() * (b - a);
const pausa = () => esperar(aleatorio(CONFIG.pausaMinMs, CONFIG.pausaMaxMs));
const agora = () => new Date().toLocaleTimeString('pt-BR');
const log = (...a) => console.log(`[${agora()}]`, ...a);

function perguntarEnter(mensagem) {
  process.stdout.write('\x07\x07\x07'); // apita para chamar sua atenção
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question('\n👉 ' + mensagem + '\n   (depois aperte ENTER aqui) ', () => { rl.close(); resolve(); }));
}

function precisaHumano(url) {
  return /\/captcha\/|\/jms\/|\/login|\/registration|account-verification/i.test(url);
}

// Abre uma página; se o Mercado Livre pedir login/captcha, espera VOCÊ resolver.
async function abrir(page, url, motivoHumano) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await esperar(3500);
    const atual = page.url();
    if (!precisaHumano(atual) && !/afiliados-home/.test(atual)) return true;
    if (/captcha/i.test(atual)) {
      await esperar(8000); // às vezes é uma verificação automática de segundos
      if (!/captcha/i.test(page.url())) continue;
    }
    await perguntarEnter(motivoHumano || 'O Mercado Livre pediu login ou verificação. Resolva na janela do Chrome (conta de AFILIADO).');
  }
  return false;
}

// ---------- servidor (SSH/SCP) ----------
function scp(origem, destino) {
  return new Promise((resolve, reject) => {
    execFile('scp', ['-i', SERVIDOR.chave, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', origem, destino],
      { timeout: 60000 }, (erro, _o, e) => (erro ? reject(new Error((e || erro.message).trim())) : resolve()));
  });
}

const idDoLink = (url) => (String(url).match(/MLB-?U?\d+/i) || [''])[0].replace('-', '').toUpperCase();

async function listaDoServidor() {
  try {
    await scp(`${SERVIDOR.host}:${SERVIDOR.pasta}/products.json`, LISTA_SERVIDOR);
  } catch (e) {
    log('⚠️ Não consegui baixar a lista do servidor (' + e.message + '). Uso a última cópia, se houver.');
  }
  const ids = new Set();
  const links = new Set();
  try {
    const lista = JSON.parse(fs.readFileSync(LISTA_SERVIDOR, 'utf8').replace(/^\uFEFF/, ''));
    for (const p of lista) {
      const m = idDoLink(p.linkOriginal);
      if (m) ids.add(m);
      if (p.linkAfiliado) links.add(p.linkAfiliado);
    }
    log(`📦 Lista do servidor: ${lista.length} produtos (serão ignorados os repetidos).`);
  } catch (e) {
    log('ℹ️ Sem lista do servidor: vou coletar sem checar repetidos (o servidor ignora duplicados).');
  }
  return { ids, links };
}

async function enviarLote(itens) {
  fs.mkdirSync(LOTES, { recursive: true });
  const nome = `lote-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const local = path.join(LOTES, nome);
  fs.writeFileSync(local, JSON.stringify(itens, null, 2));
  await scp(local, `${SERVIDOR.host}:${SERVIDOR.pasta}/coletor-entrada/${nome}`);
  return nome;
}

// ---------- estado do dia ----------
function lerEstado() {
  const hoje = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD
  try {
    const e = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
    if (e.dia === hoje) return e;
  } catch (_) {}
  return { dia: hoje, coletados: 0, rodadas: 0 };
}
const salvarEstado = (e) => fs.writeFileSync(ESTADO, JSON.stringify(e, null, 2));

// ---------- leitura da busca ----------
async function lerBusca(page) {
  return page.evaluate(() => {
    const dinheiro = (el) => {
      if (!el) return null;
      const f = el.querySelector('.andes-money-amount__fraction');
      const c = el.querySelector('.andes-money-amount__cents');
      if (!f) return null;
      return parseFloat(f.textContent.replace(/\./g, '') + '.' + (c ? c.textContent : '00'));
    };
    return [...document.querySelectorAll('div.poly-card')].map((c) => {
      const a = [...c.querySelectorAll('a[href]')].find((x) =>
        /MLB-?U?\d+/i.test(x.href) && !/click1\.|publicidade\./.test(x.href));
      if (!a) return null; // anúncio patrocinado: ignora
      if (/\bInternacional\b/.test(c.innerText)) return null; // produto do exterior (China etc.): ignora
      const url = a.href.split('#')[0].split('?')[0];
      const titulo = (c.querySelector('.poly-component__title') || {}).innerText || '';
      const atual = dinheiro(c.querySelector('.poly-price__current'));
      const antigo = dinheiro(c.querySelector('.andes-money-amount--previous'));
      const off = (c.innerText.match(/(\d+)%\s*OFF/) || [])[1];
      const rev = ((c.querySelector('.poly-component__review-compacted') || {}).innerText || '').replace(/\s+/g, ' ');
      const nota = (rev.match(/(\d\.\d)/) || [])[1];
      const v = rev.match(/\+?([\d.,]+)\s*(mil)?\s*vendidos/i);
      let vendidos = null;
      if (v) { vendidos = parseFloat(v[1].replace(/\./g, '').replace(',', '.')); if (v[2]) vendidos *= 1000; }
      return { url, titulo: titulo.trim(), preco: atual, precoAntigo: antigo, desconto: off ? Number(off) : null,
               avaliacao: nota ? Number(nota) : null, vendidos };
    }).filter(Boolean);
  });
}

// ROTA 1: barra "Afiliados" na página do produto -> botão Compartilhar.
async function linkPelaBarra(page) {
  try {
    await page.waitForSelector('.generate_link_button', { timeout: 12000 });
    await esperar(1500 + Math.random() * 2000);
    await page.click('.generate_link_button');
    const link = await page.waitForFunction(() => {
      for (const i of document.querySelectorAll('input, textarea')) {
        if (/^https:\/\/meli\.la\/\w+$/.test((i.value || '').trim())) return i.value.trim();
      }
      return false;
    }, { timeout: 15000 });
    return await link.jsonValue();
  } catch (e) { return null; }
}

// ROTA 2 (reserva): painel de afiliados.
async function linkPeloPainel(page, urlProduto) {
  try {
    if (!(await abrir(page, URL_PAINEL, 'Entre na conta de AFILIADO na janela do Chrome.'))) return null;
    await page.waitForSelector('textarea', { timeout: 15000 });
    await page.click('textarea');
    await page.keyboard.type(urlProduto, { delay: 15 });
    await esperar(1200);
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^Gerar$/.test(x.innerText.trim()));
      if (!b || b.disabled) return false;
      b.click();
      return true;
    });
    if (!ok) return null;
    const link = await page.waitForFunction(() => {
      const m = document.body.innerHTML.match(/https:\/\/meli\.la\/\w+/);
      return m ? m[0] : false;
    }, { timeout: 20000 });
    return await link.jsonValue();
  } catch (e) { return null; }
}

// ---------- uma rodada ----------
async function rodada(browser, meta) {
  const page = await browser.newPage();
  const resultado = [];
  try {
    if (!(await abrir(page, URL_PAINEL, 'Entre no Mercado Livre com a conta de AFILIADO na janela do Chrome.'))) {
      throw new Error('Não consegui abrir o painel de afiliados (login/captcha não resolvido).');
    }
    const jaTem = await listaDoServidor();
    const vistos = new Set();
    let candidatos = [];

    // sorteia buscas/páginas até juntar candidatos suficientes (máx. 4 buscas)
    const buscas = [...CONFIG.buscas].sort(() => Math.random() - 0.5);
    for (const busca of buscas.slice(0, 4)) {
      if (candidatos.length >= meta * 2) break;
      const pag = 1 + Math.floor(Math.random() * CONFIG.paginasMax);
      const desde = pag > 1 ? `_Desde_${(pag - 1) * 48 + 1}` : '';
      const urlBusca = `https://lista.mercadolivre.com.br/${busca}${desde}_Discount_${CONFIG.descontoMin}-100_NoIndex_True`;
      log(`🔎 Buscando "${busca}" (página ${pag})`);
      if (!(await abrir(page, urlBusca, 'Captcha na busca. Resolva na janela do Chrome.'))) continue;
      await esperar(2500);
      const lidos = await lerBusca(page);
      for (const p of lidos) {
        const id = idDoLink(p.url);
        if (!id || vistos.has(id) || jaTem.ids.has(id)) continue;
        vistos.add(id);
        if (!p.preco || !p.precoAntigo || p.precoAntigo <= p.preco) continue;
        if ((p.desconto || 0) < CONFIG.descontoMin) continue;
        if (p.avaliacao && p.avaliacao < CONFIG.avaliacaoMin) continue;
        candidatos.push(p);
      }
      log(`   ${lidos.length} produtos na página; candidatos novos até agora: ${candidatos.length}`);
      await pausa();
    }

    for (const p of candidatos) {
      if (resultado.filter((r) => r.linkAfiliado).length >= meta) break;
      log('➡️  ' + p.titulo.slice(0, 70));
      await pausa();
      if (!(await abrir(page, p.url, 'Captcha/login na página do produto. Resolva na janela do Chrome.'))) continue;
      await esperar(2000);
      await page.waitForFunction(() => /GANHOS/i.test((document.querySelector('.toolbar__actions') || {}).innerText || ''),
        { timeout: 6000 }).catch(() => {});

      const extra = await page.evaluate(() => {
        const barra = (document.querySelector('.toolbar__actions') || {}).innerText || '';
        const g = barra.match(/GANHOS\s*(\d+(?:[.,]\d+)?)\s*%/i);
        const og = document.querySelector('meta[property="og:image"]');
        const h1 = document.querySelector('h1');
        return { ganho: g ? parseFloat(g[1].replace(',', '.')) : null, imagem: og ? og.content : null, titulo: h1 ? h1.innerText.trim() : null };
      });

      let link = await linkPelaBarra(page);
      let via = 'barra';
      if (!link) {
        log('   ⚠️ A barra não deu o link. Tentando pelo painel...');
        link = await linkPeloPainel(page, p.url);
        via = 'painel';
      }
      resultado.push({
        marketplace: 'mercadolivre',
        titulo: extra.titulo || p.titulo,
        preco: p.preco, precoAntigo: p.precoAntigo, desconto: p.desconto,
        avaliacao: p.avaliacao, vendidos: p.vendidos,
        ganhoPercentual: extra.ganho, imagem: extra.imagem,
        linkOriginal: p.url, linkAfiliado: link,
        via: link ? via : null, status: link ? 'ok' : 'revisar',
        coletadoEm: new Date().toISOString(),
      });
      fs.writeFileSync(SAIDA, JSON.stringify(resultado, null, 2));
      log(link
        ? `   ✅ ${link} | R$ ${p.preco} (de R$ ${p.precoAntigo}, -${p.desconto}%) | ganho ${extra.ganho ?? '?'}% | via ${via}`
        : '   ❌ Não consegui gerar o link (marcado para revisar).');
    }
  } finally {
    await page.close().catch(() => {});
  }
  return resultado;
}

async function dormirAteJanela() {
  while (true) {
    const h = new Date().getHours();
    if (h >= CONFIG.janelaInicio && h < CONFIG.janelaFim) return;
    log(`💤 Fora da janela (${CONFIG.janelaInicio}h–${CONFIG.janelaFim}h). Volto a conferir em 10 min.`);
    await esperar(10 * 60 * 1000);
  }
}

(async () => {
  const continuo = process.argv.includes('--continuo');
  const argN = (process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1];
  log(continuo ? '🚀 Coletor em modo CONTÍNUO. Conectando ao Chrome...' : '🚀 Coletor (uma rodada). Conectando ao Chrome...');

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  } catch (e) {
    console.error('❌ Não achei o Chrome aberto para o robô.');
    console.error('   Abra-o antes com o comando Start-Process das instruções e rode o coletor de novo.');
    process.exit(1);
  }

  let falhasSeguidas = 0;
  try {
    while (true) {
      if (continuo) await dormirAteJanela();
      const estado = lerEstado();
      const restante = CONFIG.tetoDiario - estado.coletados;
      if (continuo && restante <= 0) {
        log(`✅ Teto de hoje atingido (${CONFIG.tetoDiario}). Descanso até amanhã.`);
        await esperar(30 * 60 * 1000);
        continue;
      }
      const meta = Math.max(1, Math.min(Number(argN) || CONFIG.porRodada, continuo ? restante : 99));

      log(`▶️ Rodada ${estado.rodadas + 1} de hoje | meta ${meta} | já coletados hoje: ${estado.coletados}/${CONFIG.tetoDiario}`);
      try {
        const itens = await rodada(browser, meta);
        const ok = itens.filter((i) => i.linkAfiliado);
        if (ok.length) {
          const nome = await enviarLote(ok);
          log(`📤 ${ok.length} produto(s) enviado(s) ao servidor (${nome}). Em até 5 min entram no sistema.`);
        } else {
          log('ℹ️ Nenhum produto novo nesta rodada.');
        }
        estado.coletados += ok.length;
        estado.rodadas += 1;
        salvarEstado(estado);
        falhasSeguidas = 0;
      } catch (erro) {
        falhasSeguidas++;
        log(`❌ Erro na rodada (${falhasSeguidas} seguido(s)): ${erro.message || erro}`);
        if (falhasSeguidas >= 3) { log('Parando: 3 erros seguidos.'); break; }
      }

      if (!continuo) break;
      const min = aleatorio(CONFIG.intervaloRodadaMin[0], CONFIG.intervaloRodadaMin[1]);
      log(`⏳ Descansando ${Math.round(min)} min até a próxima rodada.`);
      await esperar(min * 60 * 1000);
    }
  } finally {
    browser.disconnect(); // não fecha o seu Chrome
  }
})();
