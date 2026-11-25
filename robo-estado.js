// Estado do robô que o painel (front-end) precisa enxergar:
// quantas ofertas saíram hoje, quando foi a última, quando sai a próxima,
// e se o WhatsApp está conectado. Também guarda as ligações com o index.js
// (cliente do WhatsApp, função de envio, fila) para a rota "Postar agora".
//
// O contador de hoje fica em estado-robo.json (sobrevive ao reinício das 5h).
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'estado-robo.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

let ligacoes = null;          // preenchido por configurar()
let agendados = [];           // horários (ms) dos envios ainda por sair nesta hora
let conectadoEvento = null;   // último evento ready/disconnected visto
let cacheEstado = { em: 0, valor: null };

function dataLocal(d) {
  const x = d || new Date();
  const mes = String(x.getMonth() + 1).padStart(2, '0');
  const dia = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${mes}-${dia}`;
}

function ler() {
  try {
    const e = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    return {
      data: e.data || null,
      contador: Number(e.contador) || 0,
      ultimaPostagem: e.ultimaPostagem || null
    };
  } catch (_) {
    return { data: null, contador: 0, ultimaPostagem: null };
  }
}

function salvar(e) {
  try {
    fs.writeFileSync(ARQUIVO, JSON.stringify(e, null, 2), 'utf8');
  } catch (erro) {
    console.error('⚠️ Não consegui salvar estado-robo.json:', erro.message);
  }
}

function configurar(obj) { ligacoes = obj; }

function registrarPostagem() {
  const e = ler();
  const hoje = dataLocal();
  if (e.data !== hoje) { e.data = hoje; e.contador = 0; }
  e.contador += 1;
  e.ultimaPostagem = new Date().toISOString();
  salvar(e);
}

function definirAgendados(lista) { agendados = Array.isArray(lista) ? lista : []; }
function definirConectado(v) { conectadoEvento = !!v; cacheEstado = { em: 0, valor: null }; }

function carregarConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { return {}; }
}

// Próxima postagem prevista (ISO) ou null se o sistema está pausado.
function proximaPostagem(config) {
  if (!config.sistemaAtivo) return null;
  const agora = Date.now();
  const futuros = agendados.filter((t) => t > agora).sort((a, b) => a - b);
  if (futuros.length) return new Date(futuros[0]).toISOString();

  // Nada agendado nesta hora: estima o começo da próxima hora de funcionamento.
  const ini = Number(config.horarioInicio);
  const fim = Number(config.horarioFim);
  if (!isFinite(ini) || !isFinite(fim)) return null;
  const d = new Date();
  d.setMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    d.setHours(d.getHours() + 1);
    const h = d.getHours();
    if (h >= ini && h < fim) return d.toISOString();
  }
  return null;
}

// Pergunta ao WhatsApp o estado, com limite de 3 s e cache de 30 s para o
// painel não sobrecarregar o Chrome.
async function estadoWhatsApp() {
  if (!ligacoes || !ligacoes.client) return 'INDISPONIVEL';
  if (Date.now() - cacheEstado.em < 30 * 1000 && cacheEstado.valor) return cacheEstado.valor;

  let valor;
  try {
    valor = await ligacoes.comTimeout(ligacoes.client.getState(), 3000, 'estado do WhatsApp');
    if (!valor) valor = conectadoEvento ? 'CONNECTED' : 'DESCONHECIDO';
  } catch (_) {
    valor = conectadoEvento === false ? 'DESCONECTADO' : 'SEM_RESPOSTA';
  }
  cacheEstado = { em: Date.now(), valor };
  return valor;
}

async function resumo() {
  const config = carregarConfig();
  const e = ler();
  const hoje = dataLocal();
  const estado = await estadoWhatsApp();
  return {
    sucesso: true,
    sistemaAtivo: !!config.sistemaAtivo,
    whatsappConectado: estado === 'CONNECTED',
    whatsappEstado: estado,
    postadasHoje: e.data === hoje ? e.contador : 0,
    ultimaPostagem: e.ultimaPostagem,
    proximaPostagem: proximaPostagem(config),
    horarioInicio: config.horarioInicio,
    horarioFim: config.horarioFim,
    produtosPorHora: config.produtosPorHora
  };
}

function obterLigacoes() { return ligacoes; }

// Para as rotas de grupos: contador de hoje + config atual.
function lerEstado() {
  const e = ler();
  return { postadasHoje: e.data === dataLocal() ? e.contador : 0, ultimaPostagem: e.ultimaPostagem };
}

module.exports = {
  configurar, obterLigacoes, registrarPostagem, definirAgendados,
  definirConectado, resumo, proximaPostagem, estadoWhatsApp,
  lerEstado, lerConfig: carregarConfig
};
