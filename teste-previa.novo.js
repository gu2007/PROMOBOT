// TESTE (não faz parte do robô): descobre por que a prévia do link vem sem
// imagem e testa uma prévia "montada por nós" com a foto do produto.
// Manda as mensagens de teste SÓ para o seu próprio número ("Você"), nunca
// para o grupo. Precisa rodar com o robô PARADO (pm2 stop promobot).
require('dotenv').config();
require('./corrigir-whatsapp-web');

const fs = require('fs');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const produtos = JSON.parse(fs.readFileSync('./products.json', 'utf-8'));
const ativos = produtos.filter((p) => p.ativo && p.imagem && p.linkAfiliado);
const amostra = [
  ...ativos.filter((p) => p.marketplace === 'mercadolivre').slice(0, 2),
  ...ativos.filter((p) => p.marketplace === 'amazon').slice(0, 2),
];

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
  },
  webVersionCache: { type: 'local' },
});

// O que o WhatsApp devolve de verdade para um link (só um resumo dos campos).
async function olharPrevia(url) {
  return client.pupPage.evaluate(async (u) => {
    try {
      const p = await window.require('WAWebLinkPreviewChatAction').getLinkPreview(u);
      const d = p && p.data ? p.data : p;
      const resumo = {};
      if (d) {
        for (const k of Object.keys(d)) {
          const v = d[k];
          resumo[k] = typeof v === 'string' ? (v.length > 50 ? `[texto ${v.length}]` : v) : typeof v;
        }
      }
      return { veioNulo: !p, temData: !!(p && p.data), resumo };
    } catch (e) {
      return { erro: String(e && e.message ? e.message : e) };
    }
  }, url);
}

// Miniatura JPEG (até 300px) da foto do produto, feita dentro do próprio Chrome.
async function miniatura(urlImagem) {
  const media = await MessageMedia.fromUrl(urlImagem, { unsafeMime: true });
  return client.pupPage.evaluate(async (b64, mime) => {
    const img = new Image();
    await new Promise((ok, erro) => {
      img.onload = ok;
      img.onerror = () => erro(new Error('imagem inválida'));
      img.src = `data:${mime};base64,${b64}`;
    });
    const esc = Math.min(1, 300 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * esc);
    c.height = Math.round(img.height * esc);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { b64: c.toDataURL('image/jpeg', 0.75).split(',')[1], w: c.width, h: c.height };
  }, media.data, media.mimetype);
}

client.on('qr', () => {
  console.log('❌ Pediu QR code: a sessão não está disponível. Pare o robô (pm2 stop promobot) e tente de novo.');
  process.exit(1);
});

client.on('message_ack', (m, ack) => {
  // 1 = saiu do robô para o WhatsApp, 2 = chegou no aparelho, 3 = lida
  if (m.fromMe) console.log(`   ✔ confirmação ${ack} da mensagem: ${(m.body || '').split('\n')[0].slice(0, 40)}`);
});

client.on('ready', async () => {
  console.log('✅ Conectado para o teste. Amostra:', amostra.map((p) => `${p.id}/${p.marketplace}`).join(', '));
  const eu = client.info.wid._serialized;

  try {
    for (const p of amostra) {
      console.log(`\n===== Produto ${p.id} (${p.marketplace}) =====`);
      console.log('Link afiliado:', p.linkAfiliado);
      console.log('Prévia (afiliado):', JSON.stringify(await olharPrevia(p.linkAfiliado)));
      if (p.linkOriginal) {
        const orig = p.linkOriginal.startsWith('http') ? p.linkOriginal : `https://${p.linkOriginal}`;
        console.log('Prévia (original):', JSON.stringify(await olharPrevia(orig)));
      }
    }

    // Mensagens de teste para o próprio número: A = prévia normal, B = prévia montada por nós.
    for (const p of amostra) {
      const base = `${p.titulo}\n\n👉 ${p.linkAfiliado}`;

      await client.sendMessage(eu, `TESTE A (prévia normal) - produto ${p.id} ${p.marketplace}\n\n${base}`, { linkPreview: true });

      try {
        const m = await miniatura(p.imagem);
        await client.sendMessage(eu, `TESTE B (prévia montada por nós) - produto ${p.id} ${p.marketplace}\n\n${base}`, {
          linkPreview: false,
          extra: {
            title: p.titulo,
            description: (p.texto || '').slice(0, 150) || 'Oferta',
            thumbnail: m.b64,
            thumbnailWidth: m.w,
            thumbnailHeight: m.h,
            canonicalUrl: p.linkAfiliado,
            matchedText: p.linkAfiliado,
            preview: true,
            subtype: 'url',
          },
        });
        console.log(`✅ Produto ${p.id}: testes A e B enviados (miniatura ${m.w}x${m.h})`);
      } catch (e) {
        console.log(`⚠️ Produto ${p.id}: teste B falhou:`, e.message);
      }
    }
  } catch (e) {
    console.log('❌ Erro no teste:', e.message);
  }

  console.log('\n⏳ Esperando 40s para as mensagens terminarem de subir...');
  await new Promise((r) => setTimeout(r, 40000));
  console.log('\n=== FIM DO TESTE ===');
  await client.destroy();
  process.exit(0);
});

client.initialize();
