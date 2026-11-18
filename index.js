require('dotenv').config();

// Correção temporária do envio de imagem (ver o arquivo). Tem que rodar ANTES de iniciar o WhatsApp.
require('./corrigir-whatsapp-web');

const {
  escolherProximoProduto,
  registrarEnvio,
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
const iaRoute = require('./routes/ia');
const { router: verificacaoRoute, rodarVerificacaoSemanal } = require('./routes/verificacao');
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

// ======= RESILIÊNCIA =======
// Tempo máximo para uma mensagem (com ou sem imagem) sair. Passou disso, o
// envio conta como falha em vez de ficar pendurado para sempre.
const TEMPO_LIMITE_ENVIO_MS = 90 * 1000;
// Tempo máximo para baixar a imagem do produto antes de enviar.
const TEMPO_LIMITE_IMAGEM_MS = 30 * 1000;
// Quantas vezes tentar baixar / enviar a imagem antes de desistir dela.
const TENTATIVAS_IMAGEM = 3;
const PAUSA_ENTRE_TENTATIVAS_MS = 4 * 1000;
// Quantas ofertas seguidas podem sair SEM imagem até o robô se reiniciar
// (reiniciar dá um Chrome novo, que costuma voltar a enviar as fotos).
const LIMITE_SEM_IMAGEM_SEGUIDAS = 2;
// Quantas falhas de envio seguidas até o robô se reiniciar sozinho.
const LIMITE_FALHAS_SEGUIDAS = 2;
// De quanto em quanto tempo o robô testa se o WhatsApp ainda responde.
const INTERVALO_SAUDE_MS = 10 * 60 * 1000;
const TEMPO_LIMITE_SAUDE_MS = 45 * 1000;
// Quantos testes de saúde seguidos podem falhar até o robô se reiniciar.
const LIMITE_FALHAS_SAUDE = 2;
// ================================

const CONFIG_PATH = path.join(__dirname, 'config.json');

function carregarConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// Avisa o serviço de monitoramento externo (healthchecks.io). Só funciona se
// HEALTHCHECK_URL estiver no .env; sem ela, não faz nada. Nunca trava o robô.
//   avisarMonitor('')      -> "estou vivo e enviei uma oferta"
//   avisarMonitor('/fail') -> "algo deu errado" (dispara o e-mail na hora)
function avisarMonitor(sufixo) {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return;

  fetch(url + (sufixo || ''), { signal: AbortSignal.timeout(10000) }).catch(() => {});
}

// Faz uma promessa falhar se demorar mais que "ms" milissegundos.
function comTimeout(promessa, ms, descricao) {
  let temporizador;

  const limite = new Promise((_, rejeitar) => {
    temporizador = setTimeout(
      () => rejeitar(new Error(`Tempo esgotado (${ms / 1000}s): ${descricao}`)),
      ms
    );
  });

  return Promise.race([promessa, limite]).finally(() => clearTimeout(temporizador));
}

// Encerra o processo de propósito: o PM2 sobe o robô de novo, com um Chrome
// novo e limpo. Espera uns segundos para o aviso externo conseguir sair.
let reiniciando = false;

function reiniciarProcesso(motivo) {
  if (reiniciando) return;
  reiniciando = true;

  console.error(`🔁 Reiniciando o robô: ${motivo}`);
  avisarMonitor('/fail');

  setTimeout(() => process.exit(1), 5000);
}

// ---- Texto da mensagem ----

// 30.9 -> "30,90"  |  1299 -> "1.299,00"
function formatarPreco(valor) {
  const n = Number(valor);
  if (!isFinite(n)) return String(valor);
  const [inteiro, centavos] = n.toFixed(2).split('.');
  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`;
}

const TAMANHO_MAX_TITULO = 55;

// Deixa só o nome que identifica o produto: corta no primeiro separador
// (vírgula seguida de espaço, " - ", " | ", ";") e tira o que vem entre
// parênteses. Se o produto tiver o campo "tituloCurto", usa ele direto.
function tituloCurto(produto) {
  if (produto.tituloCurto && String(produto.tituloCurto).trim()) {
    return String(produto.tituloCurto).trim();
  }

  const original = String(produto.titulo || '').replace(/\s+/g, ' ').trim();

  let t = original.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.split(/\s[-–—|]\s|,\s|;\s/)[0].trim();

  if (t.length > TAMANHO_MAX_TITULO) {
    t = t.slice(0, TAMANHO_MAX_TITULO).replace(/\s+\S*$/, '');
  }

  // não termina em palavra solta ("de", "com", "para"...)
  t = t.replace(/(\s+(de|da|do|das|dos|com|para|e|em|c\/|p\/|\+|-))+$/i, '').trim();

  return t || original.slice(0, TAMANHO_MAX_TITULO);
}

// Texto de venda curto: a 1ª frase (e a 2ª, se ainda ficar curto).
function fraseDeVenda(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';

  const frases = t.match(/[^.!?]+[.!?]+/g) || [t];
  let saida = frases[0].trim();

  if (frases[1] && (saida + ' ' + frases[1].trim()).length <= 120) {
    saida += ' ' + frases[1].trim();
  }

  if (saida.length > 140) {
    saida = saida.slice(0, 137).replace(/\s+\S*$/, '') + '...';
  }

  return saida;
}

// Monta o texto da mensagem a partir de um produto
function formatarMensagem(produto) {

  const percentual = Number(produto.desconto) > 0
    ? `  🏷️ ${Math.round(Number(produto.desconto))}% OFF`
    : '';

  const precoTexto = produto.precoAntigo
    ? `~R$ ${formatarPreco(produto.precoAntigo)}~ ➡️ *R$ ${formatarPreco(produto.preco)}*${percentual}`
    : `*R$ ${formatarPreco(produto.preco)}*`;

  const venda = fraseDeVenda(produto.texto);

  let mensagem =
    `🔥 *OFERTA* 🔥\n\n` +
    `*${tituloCurto(produto)}*\n\n` +
    `💰 ${precoTexto}\n\n`;

  if (venda) {
    mensagem += `${venda}\n\n`;
  }

  mensagem +=
    `👇 *CLIQUE NO LINK ABAIXO E GARANTA O SEU* 👇\n` +
    `${produto.linkAfiliado}\n\n` +
    `_Preços podem mudar_`;

  return mensagem;
}

// Espera simples (usada entre uma tentativa e outra).
function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tenta uma ação até "tentativas" vezes. Se todas falharem, lança o último erro.
async function tentarVarias(descricao, acao) {
  let ultimoErro;

  for (let i = 1; i <= TENTATIVAS_IMAGEM; i++) {
    try {
      return await acao();
    } catch (err) {
      ultimoErro = err;
      console.error(`⚠️ ${descricao} falhou (tentativa ${i}/${TENTATIVAS_IMAGEM}):`, err.message);
      if (i < TENTATIVAS_IMAGEM) await esperar(PAUSA_ENTRE_TENTATIVAS_MS);
    }
  }

  throw ultimoErro;
}

// Pergunta ao WhatsApp se o link do produto gera uma prévia COM imagem
// (a imagem grande que aparece em cima do link, clicável até o produto).
// Amazon e Mercado Livre às vezes não entregam a imagem na hora, por isso
// quem chama tenta algumas vezes antes de desistir.
async function previaTemImagem(client, link) {
  try {
    const r = await comTimeout(
      client.pupPage.evaluate(async (url) => {
        const p = await window
          .require('WAWebLinkPreviewChatAction')
          .getLinkPreview(url);
        const d = p && p.data;
        if (!d) return { ok: false, titulo: '', campos: [] };
        const campos = Object.keys(d);
        const ok = campos.some((k) => /thumbnail/i.test(k) && d[k]);
        return { ok, titulo: String(d.title || ''), campos };
      }, link),
      30 * 1000,
      'checar a prévia do link'
    );

    console.log(`🔎 Prévia do link: ${r.ok ? 'COM imagem' : 'SEM imagem'} (título: "${r.titulo}")`);
    return r.ok;
  } catch (err) {
    console.error('⚠️ Não consegui checar a prévia do link:', err.message);
    return false;
  }
}

// Diz se a última oferta enviada saiu sem a imagem do produto.
let ultimoEnvioSemImagem = false;

// Envia um produto para o grupo, com imagem (se tiver) + texto.
// A imagem é tentada várias vezes antes de desistir. Só se todas falharem,
// manda o texto sozinho (melhor um aviso sem foto do que o grupo ficar mudo).
// Se a mensagem não sair de jeito nenhum, lança um erro.
async function enviarProduto(client, produto) {

  console.log(produto);

  const texto = formatarMensagem(produto);

  ultimoEnvioSemImagem = false;

  // 1ª opção: o link com a prévia automática do WhatsApp (imagem clicável
  // que leva direto ao produto). Só usa se a prévia realmente tiver imagem.
  if (produto.linkAfiliado) {
    let previaOk = false;

    for (let i = 1; i <= 3 && !previaOk; i++) {
      previaOk = await previaTemImagem(client, produto.linkAfiliado);
      if (!previaOk && i < 3) await esperar(5000);
    }

    if (previaOk) {
      try {
        await comTimeout(
          client.sendMessage(GROUP_ID, texto, { linkPreview: true }),
          TEMPO_LIMITE_ENVIO_MS,
          'enviar mensagem com prévia do link'
        );
        return;
      } catch (err) {
        console.error('⚠️ Falha ao enviar com a prévia do link, tentando com a foto:', err.message);
      }
    } else {
      console.error(`⚠️ A prévia do link ficou sem imagem (produto ${produto.id}, ${produto.marketplace}), enviando com a foto do produto.`);
    }
  }

  // 2ª opção: a foto do produto com o texto embaixo.
  if (produto.imagem) {
    try {
      const media = await tentarVarias('Baixar a imagem', () =>
        comTimeout(
          MessageMedia.fromUrl(produto.imagem, { unsafeMime: true }),
          TEMPO_LIMITE_IMAGEM_MS,
          'baixar a imagem do produto'
        )
      );

      await tentarVarias('Enviar a mensagem com imagem', () =>
        comTimeout(
          client.sendMessage(GROUP_ID, media, { caption: texto }),
          TEMPO_LIMITE_ENVIO_MS,
          'enviar mensagem com imagem'
        )
      );

      return;
    } catch (err) {
      console.error(`⚠️ SEM IMAGEM (produto ${produto.id}, ${produto.marketplace}), enviando só o texto:`, err.message);
    }
  }

  ultimoEnvioSemImagem = true;

  // Sem imagem ou erro ao carregar -> envia só o texto
  await comTimeout(
    client.sendMessage(GROUP_ID, texto, { linkPreview: true }),
    TEMPO_LIMITE_ENVIO_MS,
    'enviar mensagem de texto'
  );
}

// ---- Fila de envios ----
// Os envios saem um de cada vez, nunca dois ao mesmo tempo. Isso poupa o
// Chrome (que já é pesado para o servidor) e evita que dois envios escolham
// o mesmo produto.
let filaEnvios = Promise.resolve();

function enfileirar(tarefa) {
  const resultado = filaEnvios.then(tarefa);
  filaEnvios = resultado.catch(() => {});
  return resultado;
}

// Escolhe o próximo produto, envia, e SÓ DEPOIS marca como enviado. Se o
// envio falhar, o produto não é "queimado": continua disponível.
// Retorna o produto enviado, ou null se não havia produto disponível.
async function enviarProximaOferta() {

  const produto = escolherProximoProduto();

  if (!produto) return null;

  await enviarProduto(client, produto);

  try {
    registrarEnvio(produto.id);
  } catch (erro) {
    console.error('⚠️ A mensagem foi enviada, mas não consegui registrar o envio no products.json:', erro.message);
  }

  return produto;
}

let falhasSeguidas = 0;
let semImagemSeguidas = 0;

// Tarefa usada pelo agendamento automático.
async function envioAgendado() {

  try {

    const produto = await enviarProximaOferta();

    if (!produto) {
      console.log("⚠️ Nenhum produto disponível para envio (sem produtos ativos ou todos em cooldown).");
      return;
    }

    falhasSeguidas = 0;
    console.log(`✅ Oferta enviada${ultimoEnvioSemImagem ? ' (SEM IMAGEM)' : ''}: ${produto.titulo}`);
    avisarMonitor('');

    if (ultimoEnvioSemImagem) {
      semImagemSeguidas++;
      if (semImagemSeguidas >= LIMITE_SEM_IMAGEM_SEGUIDAS) {
        reiniciarProcesso(`${semImagemSeguidas} ofertas seguidas sem imagem`);
      }
    } else {
      semImagemSeguidas = 0;
    }

  } catch (err) {

    falhasSeguidas++;
    console.error(`❌ Falha no envio (${falhasSeguidas} seguida(s)):`, err.message || err);
    avisarMonitor('/fail');

    if (falhasSeguidas >= LIMITE_FALHAS_SEGUIDAS) {
      reiniciarProcesso(`${falhasSeguidas} envios seguidos falharam`);
    }

  }
}

// ---- Teste de saúde periódico ----
// Pergunta ao WhatsApp em que estado ele está. Se o Chrome travou (não
// responde) ou o WhatsApp não está conectado por duas vezes seguidas, o robô
// se reinicia — mesmo fora do horário de envio, antes de alguém precisar dele.
let falhasSaude = 0;

async function verificarSaude() {

  try {

    const estado = await comTimeout(client.getState(), TEMPO_LIMITE_SAUDE_MS, 'consultar o estado do WhatsApp');

    if (estado !== 'CONNECTED') {
      throw new Error(`estado do WhatsApp: ${estado}`);
    }

    falhasSaude = 0;

  } catch (err) {

    falhasSaude++;
    console.error(`⚠️ Teste de saúde falhou (${falhasSaude}/${LIMITE_FALHAS_SAUDE}):`, err.message);

    if (falhasSaude >= LIMITE_FALHAS_SAUDE) {
      reiniciarProcesso('o WhatsApp não está respondendo');
    }

  }
}

const client = new Client({
  authStrategy: new LocalAuth(), // guarda a sessão localmente, não precisa escanear QR toda vez
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
    ],
  },
  webVersionCache: {
    type: 'local', // usa a versão que autenticou com sucesso; se não tiver cache, busca a mais recente do próprio WhatsApp
  },
});

let qrAvisado = false;

client.on('qr', (qr) => {
  console.log('📱 Escaneie o QR Code abaixo com o WhatsApp do robô:');
  qrcode.generate(qr, { small: true });

  // Pedir QR significa que o WhatsApp desvinculou o robô: só uma pessoa
  // consegue resolver, então avisa uma vez.
  if (!qrAvisado) {
    qrAvisado = true;
    avisarMonitor('/fail');
  }
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

    const timeout = setTimeout(() => {
      enfileirar(envioAgendado);
    }, delayMs);

    scheduler.adicionar(timeout);
  }
}

// O evento "ready" pode disparar mais de uma vez (o WhatsApp Web às vezes
// recarrega sozinho). Tudo abaixo só deve ser montado uma vez.
let jaInicializado = false;

client.on('ready', () => {

  if (jaInicializado) {
    console.log('ℹ️ Evento "ready" repetido ignorado (o robô já está inicializado).');
    return;
  }

  jaInicializado = true;

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

let ultimoEstadoSistema = config.sistemaAtivo;

fs.watch(CONFIG_PATH, { persistent: true }, () => {

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

  // Teste de saúde periódico (o robô se reinicia sozinho se o WhatsApp travar)
  setInterval(verificarSaude, INTERVALO_SAUDE_MS);

  // Verificação semanal de preço/disponibilidade dos produtos ativos
  // (domingo às 3h da manhã, fora do horário normal de envios)
  // IMPORTANTE: só roda automaticamente se "verificacaoSemanalAtiva": true
  // estiver no config.json. Por padrão fica DESLIGADO, até você confirmar
  // manualmente (pelo botão "Rodar verificação agora") que está funcionando
  // bem no seu catálogo.
  cron.schedule('0 3 * * 0', () => {
    const configAtual = carregarConfig();
    if (!configAtual.verificacaoSemanalAtiva) {
        console.log('⏸️ Verificação semanal automática está desligada (verificacaoSemanalAtiva não está true no config.json). Pulando.');
        return;
    }
    console.log('🔎 Iniciando verificação semanal de preço/disponibilidade...');
    rodarVerificacaoSemanal().catch(erro => {
        console.error('❌ Erro na verificação semanal:', erro);
    });
  });

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

app.get('/editar-produto', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'editar-produto.html'));
});

app.get('/importar-ia', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'importar-ia.html'));
});

app.get('/duplicados', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'duplicados.html'));
});

app.get('/alteracoes', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard', 'alteracoes.html'));
});


    app.use('/api/dashboard', dashboardRoute);
    app.use('/api/config', configRoute);
    app.use('/api/produtos', produtosRoute);
    app.use('/api/auth', authRoute);
    app.use('/api/ia', iaRoute);
    app.use('/api/verificacao', verificacaoRoute);

    app.post('/send', async (req, res) => {
      try {
        const texto = req.body?.mensagem;

        if (texto) {

          await enfileirar(() => comTimeout(
            client.sendMessage(GROUP_ID, texto),
            TEMPO_LIMITE_ENVIO_MS,
            'enviar mensagem avulsa'
          ));

        } else {

          const produto = await enfileirar(enviarProximaOferta);

          if (!produto) {
            return res.status(400).json({ ok: false, erro: 'Nenhum produto disponível' });
          }

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
  reiniciarProcesso(`WhatsApp desconectado (${reason})`);
});

client.on('auth_failure', (mensagem) => {
  console.error('❌ Falha de autenticação do WhatsApp:', mensagem);
  reiniciarProcesso('falha de autenticação do WhatsApp');
});

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