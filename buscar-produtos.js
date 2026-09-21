// Busca produtos automaticamente no Mercado Livre, usando os termos de busca
// configurados em config.json, e gera um arquivo candidatos.json com os
// resultados, para revisar e completar com o link de afiliado depois.
//
// Uso: node buscar-produtos.js
//
// O Mercado Livre não tem API pública para gerar link de afiliado direto,
// então o script só traz o link "normal" do produto (linkOriginal) — ele
// precisa ser colado em https://afiliados.mercadolivre.com.br pra virar
// link de afiliado, que aí sim vai no campo "linkAfiliado".

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const CANDIDATOS_PATH = path.join(__dirname, 'candidatos.json');

function carregarConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// Busca produtos na API pública do Mercado Livre (sem necessidade de login)
async function buscarPorTermo(termo, limite = 10) {
  const url = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(termo)}&limit=${limite}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`Erro ao buscar "${termo}": HTTP ${resp.status}`);
  }

  const data = await resp.json();

  return (data.results || []).map((item) => ({
    nome: item.title,
    preco: String(item.price),
    precoAntigo: item.original_price ? String(item.original_price) : '',
    imagem: item.thumbnail ? item.thumbnail.replace('http://', 'https://') : '',
    linkOriginal: item.permalink,
    linkAfiliado: 'COLE_AQUI_O_LINK_DE_AFILIADO', // <- você completa isso manualmente
  }));
}

async function main() {
  const config = carregarConfig();
  const termos = config.termosDeBusca || [config.nicho];

  console.log(`Buscando produtos para o nicho: "${config.nicho}"`);
  console.log(`Termos de busca: ${termos.join(', ')}\n`);

  let todosProdutos = [];

  for (const termo of termos) {
    console.log(`Buscando: "${termo}"...`);
    try {
      const produtos = await buscarPorTermo(termo, 10);
      console.log(`  -> ${produtos.length} produtos encontrados`);
      todosProdutos = todosProdutos.concat(produtos);
    } catch (err) {
      console.error(`  -> Erro: ${err.message}`);
    }
  }

  // Remove duplicados pelo link original
  const vistos = new Set();
  const unicos = todosProdutos.filter((p) => {
    if (vistos.has(p.linkOriginal)) return false;
    vistos.add(p.linkOriginal);
    return true;
  });

  fs.writeFileSync(CANDIDATOS_PATH, JSON.stringify(unicos, null, 2));

  console.log(`\n${unicos.length} produtos únicos salvos em candidatos.json`);
  console.log('\nPróximo passo:');
  console.log('1. Abra candidatos.json');
  console.log('2. Para cada produto que quiser usar, copie o "linkOriginal"');
  console.log('3. Cole em https://afiliados.mercadolivre.com.br para gerar o link de afiliado');
  console.log('4. Cole o link gerado no campo "linkAfiliado" daquele produto');
  console.log('5. Rode "node publicar-produtos.js" para mover os produtos prontos para products.json');
}

main().catch((err) => {
  console.error('Erro geral:', err);
  process.exit(1);
});
