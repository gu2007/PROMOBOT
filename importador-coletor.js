// ======= IMPORTADOR DO COLETOR (roda no servidor) =======
// Olha a pasta "coletor-entrada". Cada arquivo .json que o coletor deixar ali
// (a lista de produtos com link de afiliado) vira produto cadastrado no
// sistema, SEMPRE INATIVO: nada vai para o grupo até você aprovar no painel
// (ative o produto na aba Produtos; procure a categoria "Coletor - revisar").
// Depois de lido, o arquivo vai para "coletor-processados".
const fs = require('fs');
const path = require('path');
const { adicionarProduto, listarProdutos } = require('./produtos');

const ENTRADA = path.join(__dirname, 'coletor-entrada');
const PROCESSADOS = path.join(__dirname, 'coletor-processados');
const ESPERA_ARQUIVO_NOVO_MS = 15 * 1000;   // evita ler arquivo ainda sendo copiado
const LIMITE_ARQUIVO_QUEBRADO_MS = 3 * 60 * 1000;

const idML = (u) => (String(u || '').match(/MLB-?U?\d+/i) || [''])[0].replace('-', '').toUpperCase();

function importarColetor() {
  fs.mkdirSync(ENTRADA, { recursive: true });
  fs.mkdirSync(PROCESSADOS, { recursive: true });

  const arquivos = fs.readdirSync(ENTRADA).filter((f) => f.toLowerCase().endsWith('.json'));
  const resumo = { novos: 0, ignorados: 0 };

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

      adicionarProduto({
        marketplace: 'mercadolivre',
        categoria: 'Coletor - revisar',
        titulo: String(item.titulo).trim(),
        preco: Number(item.preco),
        precoAntigo: Number(item.precoAntigo),
        desconto: Math.round((1 - Number(item.preco) / Number(item.precoAntigo)) * 100),
        avaliacao: item.avaliacao || null,
        vendidos: item.vendidos || null,
        ganhoPercentual: item.ganhoPercentual || null,
        imagem: item.imagem || '',
        linkOriginal: item.linkOriginal || '',
        linkAfiliado: item.linkAfiliado,
        texto: '',
        ativo: false,            // SEMPRE inativo: você aprova no painel
        origem: 'coletor',
      });
      linksJa.add(item.linkAfiliado);
      if (id) idsJa.add(id);
      resumo.novos++;
    }

    fs.renameSync(caminho, path.join(PROCESSADOS, `${Date.now()}-${nome}`));
  }

  if (resumo.novos || resumo.ignorados) {
    console.log(`📥 Coletor: ${resumo.novos} produto(s) novo(s) importado(s) (inativos, aguardando sua aprovação); ${resumo.ignorados} ignorado(s).`);
  }
}

module.exports = { importarColetor };
