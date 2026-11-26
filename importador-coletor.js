// ======= IMPORTADOR DO COLETOR (roda no servidor) =======
// Olha a pasta "coletor-entrada". Cada arquivo .json que o coletor deixar ali
// (a lista de produtos com link de afiliado) vira produto cadastrado no sistema.
//
// Controlado pelo config.json:
//   "coletorAutoAtivar": true   -> produtos BONS entram ATIVOS (vão para o grupo)
//                          false -> todos entram INATIVOS, para você aprovar
//   "coletorDescontoMin": 30    -> desconto mínimo (%) para ativar sozinho
// Mesmo ligado, entram INATIVOS (categoria "Coletor - revisar") os produtos sem
// imagem, com nota baixa, com título suspeito, ou que o sistema ache repetidos.
// Depois de lido, o arquivo vai para "coletor-processados".
const fs = require('fs');
const path = require('path');
const { adicionarProduto, listarProdutos } = require('./produtos');
const { classificar } = require('./categorias-padrao');

const ENTRADA = path.join(__dirname, 'coletor-entrada');
const PROCESSADOS = path.join(__dirname, 'coletor-processados');
const ESPERA_ARQUIVO_NOVO_MS = 15 * 1000;   // evita ler arquivo ainda sendo copiado
const LIMITE_ARQUIVO_QUEBRADO_MS = 3 * 60 * 1000;

function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return {};
  }
}

// Palavras que indicam que o produto não é o que queremos divulgar.
const TITULO_SUSPEITO = /\b(brinquedo|miniatura|infantil|usad[oa]|defeito|sucata)\b/i;

const idML = (u) => (String(u || '').match(/MLB-?U?\d+/i) || [''])[0].replace('-', '').toUpperCase();

function importarColetor() {
  fs.mkdirSync(ENTRADA, { recursive: true });
  fs.mkdirSync(PROCESSADOS, { recursive: true });

  const arquivos = fs.readdirSync(ENTRADA).filter((f) => f.toLowerCase().endsWith('.json'));
  const resumo = { novos: 0, ativos: 0, ignorados: 0 };
  const config = lerConfig();
  const autoAtivar = config.coletorAutoAtivar === true;
  const descontoMin = Number(config.coletorDescontoMin) || 30;

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
        console.error(`⚠️ Coletor: ${nome} está quebrado (${erro.message}). Movido para processados com .erro`);
        fs.renameSync(caminho, path.join(PROCESSADOS, `${Date.now()}-${nome}.erro`));
      }
      continue;
    }

    const existentes = listarProdutos();
    const idsJa = new Set(existentes.map((p) => idML(p.linkOriginal)).filter(Boolean));
    const linksJa = new Set(existentes.map((p) => p.linkAfiliado).filter(Boolean));

    for (const item of lista) {
      const ok = item && item.status === 'ok'
        && /^https:\/\/meli\.la\/\w+$/.test(String(item.linkAfiliado || ''))
        && Number(item.preco) > 0 && Number(item.precoAntigo) > Number(item.preco)
        && item.titulo;
      const id = idML(item && item.linkOriginal);
      if (!ok || linksJa.has(item.linkAfiliado) || (id && idsJa.has(id))) { resumo.ignorados++; continue; }

      const desconto = Math.round((1 - Number(item.preco) / Number(item.precoAntigo)) * 100);
      const bom = autoAtivar
        && desconto >= descontoMin
        && !!item.imagem
        && (!item.avaliacao || Number(item.avaliacao) >= 4.3)
        && !TITULO_SUSPEITO.test(String(item.titulo));

      const salvo = adicionarProduto({
        marketplace: 'mercadolivre',
        categoria: classificar(item.titulo, ''),
        titulo: String(item.titulo).trim(),
        preco: Number(item.preco),
        precoAntigo: Number(item.precoAntigo),
        desconto,
        avaliacao: item.avaliacao || null,
        vendidos: item.vendidos || null,
        ganhoPercentual: item.ganhoPercentual || null,
        imagem: item.imagem || '',
        linkOriginal: item.linkOriginal || '',
        linkAfiliado: item.linkAfiliado,
        texto: '',
        ativo: bom,   // o sistema ainda trava sozinho se for repetido ou sem desconto real
        origem: 'coletor',
      });
      if (salvo && salvo.ativo) resumo.ativos++;
      linksJa.add(item.linkAfiliado);
      if (id) idsJa.add(id);
      resumo.novos++;
    }

    fs.renameSync(caminho, path.join(PROCESSADOS, `${Date.now()}-${nome}`));
  }

  if (resumo.novos || resumo.ignorados) {
    console.log(`📥 Coletor: ${resumo.novos} produto(s) novo(s) (${resumo.ativos} ativado(s) automaticamente, ${resumo.novos - resumo.ativos} para revisar); ${resumo.ignorados} ignorado(s).`);
  }
}

module.exports = { importarColetor };
