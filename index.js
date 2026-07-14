const {
  proximoProduto,
  totalProdutos,
  totalProdutosAtivos,
  totalCategorias
} = require('./produtos');

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dashboardRoute = require('./routes/dashboard');
const configRoute = require('./routes/config');
const produtosRoute = require('./routes/produtos');
const authRoute = require('./routes/auth');
const session = require('express-session');
const scheduler = require('./scheduler');

// ======= CONFIGURAÇÕES =======
// Cole aqui o ID do grupo. Para descobrir o ID, rode: npm run listar-grupos
const GROUP_ID = '120363425600322669@g.us';

// Se USAR_N8N = true, também sobe a API HTTP para o n8n poder disparar envios.
// O agendamento automático por hora (config.json) funciona nos dois casos.
const USAR_N8N = true;
const PORTA_WEB = 3000;
// ================================

const CONFIG_PATH = path.join(__dirname, 'config.json');

function carregarConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}


// Monta o texto da mensagem a partir de um produto
function formatarMensagem(produto) {

  const precoTexto = produto.precoAntigo
    ? `~R$ ${produto.precoAntigo}~ ➡️ *R$ ${produto.preco}*`
    : `*R$ ${produto.preco}*`;

  let mensagem =
    `🔥 *OFERTA* 🔥\n\n` +
    `${produto.titulo}\n\n` +
    `💰 ${precoTexto}\n\n`;

  if (produto.texto && produto.texto.trim() !== '') {
    mensagem += `${produto.texto}\n\n`;
  }

  mensagem +=
    `👉 ${produto.linkAfiliado}\n\n` +
    `_Preços podem mudar_`;

  return mensagem;}

// Envia um produto para o grupo, com imagem (se tiver) + texto
async function enviarProduto(client, produto) {

  console.log(produto);
  
  const texto = formatarMensagem(produto);

  if (produto.imagem) {
    try {
      const media = await MessageMedia.fromUrl(produto.imagem, { unsafeMime: true });
      await client.sendMessage(GROUP_ID, media, { caption: texto });
      return;
    } catch (err) {
      console.error('⚠️ Não consegui carregar a imagem, enviando só o texto:', err.message);
    }
  }

  // Sem imagem ou erro ao carregar -> envia só o texto
  await client.sendMessage(GROUP_ID, texto);
}

const client = new Client({
  authStrategy: new LocalAuth(), // guarda a sessão localmente, não precisa escanear QR toda vez
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1031490220-alpha.html',
  },
});

client.on('qr', (qr) => {
  console.log('📱 Escaneie o QR Code abaixo com o WhatsApp do robô:');
  qrcode.generate(qr, { small: true });
});

// ---- Agendamento automático baseado em config.json ----
// A cada hora "cheia", verifica se está dentro do horário permitido e, se sim,
// agenda N envios (produtosPorHora) espaçados dentro dessa hora, em minutos
// aleatórios (evita mandar tudo de uma vez, o que pareceria spam).
function agendarEnviosDaHora(client) {

  scheduler.limpar();

  const config = carregarConfig();

  // Sistema desligado pelo Dashboard
  if (!config.sistemaAtivo) {

    scheduler.limpar();

    console.log("⏸️ Sistema pausado pelo Dashboard.");

    return;

}

  const agora = new Date();
  const horaAtual = agora.getHours();

  if (horaAtual < config.horarioInicio || horaAtual >= config.horarioFim) {
    console.log(`⏸️ Fora do horário configurado (${config.horarioInicio}h-${config.horarioFim}h). Nenhum envio nesta hora.`);
    return;
  }

  const n = config.produtosPorHora || 1;
  console.log(`📅 Agendando ${n} envio(s) para essa hora (${horaAtual}h)...`);

  // Divide os 60 minutos da hora em N faixas e escolhe um minuto aleatório
  // dentro de cada faixa, para os envios não saírem todos juntos.
  const faixaMin = Math.floor(60 / n);

  for (let i = 0; i < n; i++) {
    const minutoBase = i * faixaMin;
    const minutoAleatorio = minutoBase + Math.floor(Math.random() * faixaMin);
    const delayMs = minutoAleatorio * 60 * 1000;

    const timeout = setTimeout(async () => {

    const produto = proximoProduto();

    if (!produto) {
        console.log("⚠️ Nenhum produto disponível para envio (sem produtos ativos ou todos em cooldown).");
        return;
    }

    try {
        await enviarProduto(client, produto);
        console.log(`✅ Oferta enviada: ${produto.titulo}`);
    } catch (err) {
        console.error(err);
    }

}, delayMs);

scheduler.adicionar(timeout);
  }
}

client.on('ready', () => {
  console.log('✅ Robô conectado e pronto!');

  const config = carregarConfig();
  console.clear();

console.log("═══════════════════════════════════════");
console.log("🤖 PROMOBOT ONLINE");
console.log("═══════════════════════════════════════");
console.log(`📦 Produtos cadastrados : ${totalProdutos()}`);
console.log(`✅ Produtos ativos      : ${totalProdutosAtivos()}`);
console.log(`📂 Categorias           : ${totalCategorias()}`);
console.log(`🏷️ Nicho atual          : ${config.nicho}`);
console.log(`⏰ Funcionamento        : ${config.horarioInicio}h às ${config.horarioFim}h`);
console.log(`📤 Produtos por hora    : ${config.produtosPorHora}`);
console.log("═══════════════════════════════════════\n");

fs.watch(CONFIG_PATH, { persistent: true }, () => {

let ultimoEstadoSistema = carregarConfig().sistemaAtivo;

    // Pequeno delay para garantir que o arquivo terminou de ser salvo
    setTimeout(() => {

        try {

            const config = carregarConfig();

            if (config.sistemaAtivo === ultimoEstadoSistema) {
                return;
            }

            ultimoEstadoSistema = config.sistemaAtivo;

            if (config.sistemaAtivo) {

                console.log("▶️ Sistema ligado pelo Dashboard.");

                scheduler.limpar();
                agendarEnviosDaHora(client);

            } else {

                console.log("⏸️ Sistema desligado pelo Dashboard.");

                scheduler.limpar();

            }

        } catch (erro) {

            console.error("Erro ao atualizar configuração:", erro.message);

        }

    }, 100);

});

  // Roda uma vez já ao iniciar (caso já esteja dentro do horário)
  agendarEnviosDaHora(client);

  // E depois, a cada hora cheia (minuto 0), decide os envios daquela hora
  cron.schedule('0 * * * *', () => agendarEnviosDaHora(client));

  // API para o n8n (opcional) - permite disparar um envio manualmente/externamente
if (USAR_N8N) {
    console.log("➡️ Entrou no bloco do Express");

    const app = express();

    console.log("✅ Express criado");

    app.use(express.json());

    app.use(session({
      secret: 'promobot-secret-troque-isso',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dias
    }));

    function requireLogin(req, res, next) {

      const rotasPublicas = ['/login.html', '/api/auth/login', '/send'];
      const isAsset = req.path.startsWith('/assets/');

      if (rotasPublicas.includes(req.path) || isAsset) return next();

      if (req.session && req.session.autenticado) return next();

      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });
      }

      return res.redirect('/login.html');
    }

    app.use(requireLogin);

    // Arquivos estáticos do painel
app.use(express.static(path.join(__dirname, 'dashboard')));

// Página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

// Configurações
app.get('/configuracoes', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'configuracoes.html'));
});

// Produtos
app.get('/produtos', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'produtos.html'));
});

app.get('/novo-produto', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'novo-produto.html'));
});


    app.use('/api/dashboard', dashboardRoute);
    app.use('/api/config', configRoute);
    app.use('/api/produtos', produtosRoute);
    app.use('/api/auth', authRoute);

    app.post('/send', async (req, res) => {
      try {
        let texto = req.body?.mensagem;
        let produto = null;

        if (!texto) {
          produto = proximoProduto();
          if (!produto) {
            return res.status(400).json({ ok: false, erro: 'Nenhum produto disponível' });
          }
        }

        if (produto) {
          await enviarProduto(client, produto);
        } else {
          await client.sendMessage(GROUP_ID, texto);
        }

        console.log('✅ Mensagem enviada via n8n/API');
        res.json({ ok: true });
      } catch (err) {
        console.error('❌ Erro ao enviar mensagem:', err);
        res.status(500).json({ ok: false, erro: String(err) });
      }
    });

    const servidor = app.listen(PORTA_WEB, () => {
    console.log("═══════════════════════════════════════");
    console.log(`🌐 Dashboard disponível em http://localhost:${PORTA_WEB}`);
    console.log(`📡 API disponível em http://localhost:${PORTA_WEB}/send`);
    console.log("═══════════════════════════════════════");
});

servidor.on("error", (erro) => {
    console.error("❌ Erro ao iniciar o servidor Express:");
    console.error(erro);
});
  }
});

client.on('disconnected', (reason) => {
  console.log('Cliente desconectado:', reason);
});

let ultimoEstadoSistema = carregarConfig().sistemaAtivo;

client.initialize();

// ---- Comando extra: rode "node index.js listar-grupos" para descobrir o ID do seu grupo ----
if (process.argv[2] === 'listar-grupos') {
  client.on('ready', async () => {
    const chats = await client.getChats();
    const grupos = chats.filter((c) => c.isGroup);
    console.log('\n📋 Grupos encontrados:\n');
    grupos.forEach((g) => console.log(`${g.name} -> ${g.id._serialized}`));
    process.exit(0);
  });
}
