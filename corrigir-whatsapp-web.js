// Correção temporária para a biblioteca whatsapp-web.js (1.34.8).
//
// Problema: depois de uma atualização do WhatsApp Web, o envio de qualquer
// foto/vídeo falha com "Data passed to getter must include an id property".
// Causa: um campo "id" da mídia sobrescreve o "id" da mensagem.
// Correção: garantir que o "id" da mensagem seja o último a valer.
// (Mesma correção dos pedidos abertos #201923 / #201925 no GitHub da
// biblioteca. Quando uma versão nova da biblioteca trouxer isso, este arquivo
// deixa de ser necessário e pode ser removido, junto com o require no index.js.)
//
// É seguro rodar várias vezes: só altera a biblioteca se ainda não alterou.

const fs = require('fs');
const path = require('path');

const MARCA = 'PROMOBOT-FIX-ID';
const ANCORA = "// Bot's won't reply if canonicalUrl is set (linking)";

function aplicarCorrecao() {
  try {
    const arquivo = path.join(
      __dirname, 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js'
    );

    const codigo = fs.readFileSync(arquivo, 'utf-8');

    if (codigo.includes(MARCA)) {
      return; // já corrigido
    }

    if (codigo.split(ANCORA).length !== 2) {
      console.error('⚠️ Correção do whatsapp-web.js NÃO aplicada: o código da biblioteca é diferente do esperado.');
      return;
    }

    const linha = `message.id = newMsgKey; // ${MARCA}: o id da mensagem tem que ser o último a valer\n        `;
    fs.writeFileSync(arquivo, codigo.replace(ANCORA, linha + ANCORA), 'utf-8');

    console.log('🩹 Correção do envio de imagem aplicada no whatsapp-web.js');
  } catch (err) {
    console.error('⚠️ Não consegui aplicar a correção do whatsapp-web.js:', err.message);
  }
}

aplicarCorrecao();
