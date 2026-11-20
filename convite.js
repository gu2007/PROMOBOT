// ======= CONVITE AUTOMÁTICO =======
// A cada N ofertas enviadas, manda uma mensagem pedindo para os membros
// convidarem amigos, com o link de convite do grupo.
//
// Controlado pelo config.json:
//   "conviteModo": "desligado" | "teste" | "grupo"
//        desligado = não faz nada
//        teste     = manda SÓ para "conviteNumeroTeste" (o grupo não recebe nada)
//        grupo     = manda no grupo
//   "conviteNumeroTeste": "5511999999999"   (DDI + DDD + número, só dígitos)
//   "conviteACada": 15                      (a cada quantas ofertas)
//   "conviteLink": "https://chat.whatsapp.com/XXXX"  (opcional; se vazio,
//        o robô tenta descobrir sozinho — só funciona se ele for admin)
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'convite.json');

function lerEstado() {
  try {
    const e = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    return { contador: Number(e.contador) || 0 };
  } catch (_) {
    return { contador: 0 };
  }
}

function salvarEstado(estado) {
  const tmp = ARQUIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(estado));
  fs.renameSync(tmp, ARQUIVO);
}

function formatarConvite(link) {
  return `🤝 *Gostou do grupo?*\n\n` +
    `Convide aquele amigo que também ama pagar barato em ferramentas! 🔧\n\n` +
    `👇 *LINK DE CONVITE* 👇\n${link}`;
}

async function descobrirLink(client, groupId, config) {
  if (config.conviteLink && /^https:\/\/chat\.whatsapp\.com\//.test(config.conviteLink)) {
    return config.conviteLink.trim();
  }
  const chat = await client.getChatById(groupId);
  const codigo = await chat.getInviteCode();
  return `https://chat.whatsapp.com/${codigo}`;
}

async function enviar(client, groupId, config, destino) {
  const link = await descobrirLink(client, groupId, config);
  const texto = formatarConvite(link);

  if (destino === 'grupo') {
    await client.sendMessage(groupId, texto, { linkPreview: true });
    return;
  }

  const digitos = String(config.conviteNumeroTeste || '').replace(/\D/g, '');
  if (!digitos) throw new Error('conviteNumeroTeste não preenchido no config.json');
  const id = await client.getNumberId(digitos);
  if (!id) throw new Error('número de teste não encontrado no WhatsApp: ' + digitos);
  await client.sendMessage(id._serialized, '🧪 *TESTE DO CONVITE* (só você recebeu)\n\n' + texto, { linkPreview: true });
}

// Chamar depois de CADA oferta enviada com sucesso. Nunca lança erro.
async function aposOferta(client, groupId, config, comTimeout) {
  try {
    const modo = config.conviteModo || 'desligado';
    if (modo !== 'teste' && modo !== 'grupo') return;

    const aCada = Math.max(1, Number(config.conviteACada) || 15);
    const estado = lerEstado();
    estado.contador++;

    if (estado.contador < aCada) {
      salvarEstado(estado);
      return;
    }

    await comTimeout(enviar(client, groupId, config, modo), 90 * 1000, 'enviar convite');
    estado.contador = 0;
    salvarEstado(estado);
    console.log(`🤝 Convite enviado (${modo === 'grupo' ? 'no grupo' : 'SÓ PARA TESTE'}).`);
  } catch (erro) {
    // Falha no convite não pode atrapalhar as ofertas. Tenta de novo na próxima.
    console.error('⚠️ Não consegui enviar o convite:', erro.message || erro);
  }
}

// Manda o convite de TESTE agora (só para o número de teste), sem mexer no contador.
async function testeAgora(client, groupId, config, comTimeout) {
  try {
    await comTimeout(enviar(client, groupId, config, 'teste'), 90 * 1000, 'enviar convite de teste');
    console.log('🧪 Convite de teste enviado para o número de teste.');
  } catch (erro) {
    console.error('⚠️ Não consegui enviar o convite de teste:', erro.message || erro);
  }
}

module.exports = { aposOferta, testeAgora, formatarConvite };
