// ======= COLETOR DE PRODUTOS (Mercado Livre) =======
// Roda NO SEU PC (não no servidor). Abre um Chrome próprio, busca produtos em
// promoção no seu nicho, gera o link de afiliado de cada um e salva tudo em
// coletor/resultado.json. NÃO mexe no products.json nem no servidor.
//
// Como rodar (PowerShell):   cd C:\PROMOBOT   e depois   node coletor\coletor.js
//
// ANTES de rodar, abra o Chrome do robô (comando nas instruções) e entre na
// conta de afiliado NELE, você mesmo. Se aparecer captcha, você resolve na
// janela e aperta ENTER no PowerShell. O robô nunca tenta burlar captcha.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------- AJUSTES ----------
const CONFIG = {
  buscas: ['ferramentas-automotivas'], // trechos de busca (como na URL do Mercado Livre)
  descontoMin: 30,                     // só produtos com pelo menos esse % de desconto
  avaliacaoMin: 4.3,                   // ignora produtos com nota menor (se tiver nota)
  quantidade: 5,                       // quantos produtos coletar nesta rodada (máx. 10)
  pausaMinMs: 6000,                    // pausa mínima entre ações (ritmo humano)
  pausaMaxMs: 14000,                   // pausa máxima
};
// -----------------------------

const SAIDA = path.join(__dirname, 'resultado.json');
const PRODUTOS = path.join(__dirname, '..', 'products.json');
const URL_PAINEL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const pausa = () => esperar(CONFIG.pausaMinMs + Math.random() * (CONFIG.pausaMaxMs - CONFIG.pausaMinMs));

function perguntarEnter(mensagem) {
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
      // às vezes é uma verificação automática de segundos
      await esperar(8000);
      if (!/captcha/i.test(page.url())) continue;
    }
    await perguntarEnter(motivoHumano || 'O Mercado Livre pediu login ou verificação. Resolva na janela do Chrome (conta de AFILIADO).');
  }
  return false;
}

function idsExistentes() {
  const ids = new Set();
  try {
    const lista = JSON.parse(fs.readFileSync(PRODUTOS, 'utf8').replace(/^\uFEFF/, ''));
    for (const p of lista) {
      for (const campo of [p.linkOriginal, p.linkAfiliado]) {
        const m = String(campo || '').match(/MLB-?U?\d+/i);
        if (m) ids.add(m[0].replace('-', '').toUpperCase());
      }
    }
  } catch (e) {
    console.log('ℹ️ Não consegui ler o products.json (' + e.message + '). Vou coletar sem checar duplicados.');
  }
  return ids;
}

const idDoLink = (url) => (String(url).match(/MLB-?U?\d+/i) || [''])[0].replace('-', '').toUpperCase();

// Lê os cards da página de busca.
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
      const url = a.href.split('#')[0].split('?')[0];
      const titulo = (c.querySelector('.poly-component__title') || {}).innerText || '';
      const atual = dinheiro(c.querySelector('.poly-price__current'));
      const antigo = dinheiro(c.querySelector('.andes-money-amount--previous'));
      const texto = c.innerText;
      const off = (texto.match(/(\d+)%\s*OFF/) || [])[1];
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

// ROTA 1 (principal): barra "Afiliados" na página do produto -> botão Compartilhar.
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
  } catch (e) {
    return null;
  }
}

// ROTA 2 (reserva): painel de afiliados (cola o link do produto e clica Gerar).
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
  } catch (e) {
    return null;
  }
}

(async () => {
  const quantidade = Math.min(CONFIG.quantidade, 10);
  console.log('🚀 Coletor iniciado. Meta: ' + quantidade + ' produto(s). Conectando ao Chrome...');

  // O robô NÃO abre o Chrome: ele se conecta a um Chrome NORMAL que você abriu
  // (e onde você mesmo entrou na conta). Isso evita o bloqueio de login.
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  } catch (e) {
    console.error('❌ Não achei o Chrome aberto para o robô.');
    console.error('   Abra-o primeiro com este comando no PowerShell (veja as instruções) e rode o coletor de novo.');
    process.exit(1);
  }
  const page = await browser.newPage();

  const resultado = [];
  const salvar = () => fs.writeFileSync(SAIDA, JSON.stringify(resultado, null, 2));

  try {
    // 1) garante que está logado na conta de afiliado
    if (!(await abrir(page, URL_PAINEL, 'Entre no Mercado Livre com a conta de AFILIADO na janela do Chrome.'))) {
      throw new Error('Não consegui abrir o painel de afiliados (login/captcha não resolvido).');
    }
    console.log('✅ Painel de afiliados aberto (logado).');

    const jaTem = idsExistentes();
    console.log('📦 Produtos que você já tem (serão ignorados): ' + jaTem.size);

    // 2) busca
    let candidatos = [];
    for (const busca of CONFIG.buscas) {
      const urlBusca = `https://lista.mercadolivre.com.br/${busca}_Discount_${CONFIG.descontoMin}-100_NoIndex_True`;
      console.log('🔎 Buscando: ' + busca);
      if (!(await abrir(page, urlBusca, 'Captcha na busca. Resolva na janela do Chrome.'))) continue;
      await esperar(2500);
      const lidos = await lerBusca(page);
      console.log('   ' + lidos.length + ' produtos normais na página.');
      candidatos = candidatos.concat(lidos);
      await pausa();
    }

    const vistos = new Set();
    candidatos = candidatos.filter((p) => {
      const id = idDoLink(p.url);
      if (!id || vistos.has(id) || jaTem.has(id)) return false;
      vistos.add(id);
      if (!p.preco || !p.precoAntigo || p.precoAntigo <= p.preco) return false;
      if ((p.desconto || 0) < CONFIG.descontoMin) return false;
      if (p.avaliacao && p.avaliacao < CONFIG.avaliacaoMin) return false;
      return true;
    });
    console.log('🧮 Candidatos novos, com desconto real: ' + candidatos.length);

    // 3) para cada candidato: abre a página, lê comissão e imagem, gera o link
    for (const p of candidatos) {
      if (resultado.filter((r) => r.linkAfiliado).length >= quantidade) break;
      console.log('\n➡️  ' + p.titulo.slice(0, 70));
      await pausa();
      if (!(await abrir(page, p.url, 'Captcha/login na página do produto. Resolva na janela do Chrome.'))) continue;
      await esperar(2000);

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
        console.log('   ⚠️ A barra não deu o link. Tentando pelo painel...');
        link = await linkPeloPainel(page, p.url);
        via = 'painel';
      }

      const item = {
        marketplace: 'mercadolivre',
        titulo: extra.titulo || p.titulo,
        preco: p.preco,
        precoAntigo: p.precoAntigo,
        desconto: p.desconto,
        avaliacao: p.avaliacao,
        vendidos: p.vendidos,
        ganhoPercentual: extra.ganho,
        imagem: extra.imagem,
        linkOriginal: p.url,
        linkAfiliado: link,
        via: link ? via : null,
        status: link ? 'ok' : 'revisar',
        coletadoEm: new Date().toISOString(),
      };
      resultado.push(item);
      salvar();
      console.log(link
        ? `   ✅ ${link}  | R$ ${p.preco} (de R$ ${p.precoAntigo}, -${p.desconto}%) | ganho ${extra.ganho ?? '?'}% | via ${via}`
        : '   ❌ Não consegui gerar o link (marcado para revisar).');
    }

    const ok = resultado.filter((r) => r.linkAfiliado).length;
    console.log(`\n🏁 Fim. ${ok} produto(s) com link, ${resultado.length - ok} para revisar.`);
    console.log('📄 Resultado salvo em: ' + SAIDA);
  } catch (erro) {
    console.error('\n❌ Erro: ' + (erro.message || erro));
    salvar();
  } finally {
    await esperar(1500);
    await page.close().catch(() => {});
    browser.disconnect(); // não fecha o seu Chrome
  }
})();
