// ======= APLICADOR DA REVISÃO (roda no servidor) =======
// O "revisor" (robô no seu PC) abre a página de cada produto no Mercado Livre,
// lê o preço de verdade e deixa um arquivo na pasta "revisao-entrada".
// Este arquivo lê esses resultados e arruma o catálogo SOZINHO:
//   - produto indisponível/pausado        -> DESATIVA
//   - preço mudou                          -> CORRIGE preço, preço antigo e desconto
//   - desconto ficou baixo (abaixo do mínimo) ou sumiu -> DESATIVA
//   - desconto absurdo (acima do máximo, provável erro) -> DESATIVA e marca para você olhar
//   - voltou a ficar bom (e foi o próprio revisor que desativou) -> REATIVA
// Produtos que VOCÊ desativou à mão, ou que são duplicados suspeitos, nunca são reativados.
//
// config.json (todos opcionais):
//   "revisorDescontoMin": 30   (padrão: o mesmo de coletorDescontoMin, ou 30)
//   "revisorDescontoMax": 70
//   "revisorReativar": true
//
// Uso manual (no servidor):  node revisor-aplicar.js
const fs = require('fs');
const path = require('path');
const { carregarProdutos, salvarProdutos } = require('./produtos');

const ENTRADA = path.join(__dirname, 'revisao-entrada');
const PROCESSADOS = path.join(__dirname, 'revisao-processados');
const ESPERA_ARQUIVO_NOVO_MS = 15 * 1000;
const LIMITE_ARQUIVO_QUEBRADO_MS = 3 * 60 * 1000;

function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8').replace(/^﻿/, ''));
  } catch (_) {
    return {};
  }
}

function aplicarLista(lista, config) {
  const descontoMin = Number(config.revisorDescontoMin) || Number(config.coletorDescontoMin) || 30;
  const descontoMax = Number(config.revisorDescontoMax) || 70;
  const reativar = config.revisorReativar !== false;
  const agora = new Date().toISOString();

  const produtos = carregarProdutos();
  const r = { lidos: 0, indisponiveis: 0, precoCorrigido: 0, descontoBaixo: 0, suspeitos: 0, reativados: 0, erros: 0, ignorados: 0 };
  let mudou = false;

  for (const item of lista) {
    const p = item && produtos.find((x) => x.id === Number(item.id) && x.linkAfiliado === item.linkAfiliado);
    if (!p) { r.ignorados++; continue; }
    if (item.status === 'erro') { r.erros++; continue; }   // não conseguiu ler: não mexe em nada

    r.lidos++;
    p.verificadoEm = agora;
    mudou = true;

    let motivo = null;
    if (item.status === 'indisponivel') {
      motivo = 'indisponivel';
      r.indisponiveis++;
    } else if (item.status === 'ok' && Number(item.preco) > 0) {
      const preco = Number(item.preco);
      const antigo = Number(item.precoAntigo) > preco ? Number(item.precoAntigo) : null;

      if (Math.abs(preco - Number(p.preco)) >= 0.005) {
        p.precoAnterior = p.preco;
        p.preco = preco;
        r.precoCorrigido++;
      }
      p.precoAntigo = antigo;
      p.desconto = antigo ? Math.round((1 - preco / antigo) * 100) : 0;

      if (!antigo) motivo = 'sem-desconto';
      else if (p.desconto < descontoMin) motivo = 'desconto-baixo';
      else if (p.desconto > descontoMax) motivo = 'desconto-suspeito';
      if (motivo === 'sem-desconto' || motivo === 'desconto-baixo') r.descontoBaixo++;
      if (motivo === 'desconto-suspeito') r.suspeitos++;
    } else {
      r.erros++;
      continue;
    }

    if (motivo) {
      if (p.ativo) { p.ativo = false; p.desativadoPeloRevisor = true; }
      p.revisorMotivo = motivo;
    } else {
      p.revisorMotivo = null;
      if (reativar && !p.ativo && p.desativadoPeloRevisor && !p.duplicataSuspeita) {
        p.ativo = true;
        p.desativadoPeloRevisor = false;
        r.reativados++;
      }
    }
  }

  if (mudou) salvarProdutos(produtos);
  return r;
}

function aplicarRevisoes() {
  fs.mkdirSync(ENTRADA, { recursive: true });
  fs.mkdirSync(PROCESSADOS, { recursive: true });
  const arquivos = fs.readdirSync(ENTRADA).filter((f) => f.toLowerCase().endsWith('.json'));
  const config = lerConfig();

  for (const nome of arquivos) {
    const caminho = path.join(ENTRADA, nome);
    const idade = Date.now() - fs.statSync(caminho).mtimeMs;
    if (idade < ESPERA_ARQUIVO_NOVO_MS) continue;

    let lista;
    try {
      lista = JSON.parse(fs.readFileSync(caminho, 'utf8').replace(/^﻿/, ''));
      if (!Array.isArray(lista)) throw new Error('o arquivo não é uma lista');
    } catch (erro) {
      if (idade > LIMITE_ARQUIVO_QUEBRADO_MS) {
        console.error(`⚠️ Revisor: ${nome} está quebrado (${erro.message}). Movido para processados com .erro`);
        fs.renameSync(caminho, path.join(PROCESSADOS, `${Date.now()}-${nome}.erro`));
      }
      continue;
    }

    const r = aplicarLista(lista, config);
    fs.renameSync(caminho, path.join(PROCESSADOS, `${Date.now()}-${nome}`));
    console.log(`🔎 Revisor: ${r.lidos} conferido(s) | ${r.precoCorrigido} preço(s) corrigido(s) | ${r.indisponiveis} indisponível(is) | ${r.descontoBaixo} desconto baixo/sem desconto | ${r.suspeitos} desconto suspeito | ${r.reativados} reativado(s) | ${r.erros} sem leitura | ${r.ignorados} ignorado(s)`);
  }
}

module.exports = { aplicarRevisoes, aplicarLista };

// Uso manual: node revisor-aplicar.js  (ignora a espera de 15 s)
if (require.main === module) {
  fs.mkdirSync(ENTRADA, { recursive: true });
  for (const f of fs.readdirSync(ENTRADA)) {
    const c = path.join(ENTRADA, f);
    const t = new Date(Date.now() - 60 * 1000);
    try { fs.utimesSync(c, t, t); } catch (_) {}
  }
  aplicarRevisoes();
}
