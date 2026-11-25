// Cadastro de grupos de WhatsApp (grupos.json).
//
// ETAPA 2a: só o cadastro. O robô ainda posta no grupo principal usando o
// config.json. Para o painel e o robô não discordarem, o grupo PRINCIPAL
// (o que tem o mesmo whatsappId do robô) é espelhado com o config.json:
// ao ler, os números vêm do config.json; ao salvar, voltam para ele.
// Quando a Etapa 2b chegar, grupos.json passa a mandar sozinho.
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'grupos.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

// campo do grupo -> chave no config.json
const ESPELHO = {
  horarioInicio: 'horarioInicio',
  horarioFim: 'horarioFim',
  produtosPorHora: 'produtosPorHora',
  intervaloRepeticaoHoras: 'intervaloRepeticaoHoras',
  conviteACada: 'conviteACada',
  linkConvite: 'conviteLink'
};

let whatsappIdPrincipal = null;
function definirPrincipal(id) { whatsappIdPrincipal = id; }

function lerConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, '')); } catch (_) { return {}; }
}

function numeroOu(v, padrao) { return Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : padrao; }

function grupoInicial(config) {
  return {
    id: 1,
    nome: 'I Ama Promos',
    whatsappId: whatsappIdPrincipal,
    linkConvite: config.conviteLink || '',
    categorias: [],
    horarioInicio: numeroOu(config.horarioInicio, 8),
    horarioFim: numeroOu(config.horarioFim, 22),
    produtosPorHora: Math.max(1, numeroOu(config.produtosPorHora, 1)),
    intervaloRepeticaoHoras: Math.max(1, numeroOu(config.intervaloRepeticaoHoras, 24)),
    conviteACada: numeroOu(config.conviteACada, 15),
    ativo: config.sistemaAtivo !== false
  };
}

function lerArquivo() {
  try {
    const lista = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8').replace(/^﻿/, ''));
    return Array.isArray(lista) ? lista : null;
  } catch (_) { return null; }
}

function gravar(lista) {
  const tmp = ARQUIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), 'utf8');
  fs.renameSync(tmp, ARQUIVO);
}

// Lista crua do arquivo (cria o grupo 1 na primeira vez).
function carregarBruto() {
  let lista = lerArquivo();
  if (!lista || lista.length === 0) {
    lista = [grupoInicial(lerConfig())];
    gravar(lista);
    console.log('👥 grupos.json criado com o grupo principal (migrado do config.json).');
  }
  return lista;
}

function ehPrincipal(g) {
  return !!whatsappIdPrincipal && g.whatsappId === whatsappIdPrincipal;
}

// Aplica o espelho do config.json no grupo principal (leitura).
function comEspelho(g) {
  if (!ehPrincipal(g)) return { ...g };
  const config = lerConfig();
  const novo = { ...g };
  for (const [campo, chave] of Object.entries(ESPELHO)) {
    if (config[chave] !== undefined && config[chave] !== null) novo[campo] = config[chave];
  }
  novo.horarioInicio = numeroOu(novo.horarioInicio, g.horarioInicio);
  novo.horarioFim = numeroOu(novo.horarioFim, g.horarioFim);
  novo.produtosPorHora = numeroOu(novo.produtosPorHora, g.produtosPorHora);
  novo.intervaloRepeticaoHoras = numeroOu(novo.intervaloRepeticaoHoras, g.intervaloRepeticaoHoras);
  novo.conviteACada = numeroOu(novo.conviteACada, g.conviteACada);
  return novo;
}

// Escreve no config.json os campos do grupo principal (só os que mudaram).
function espelharParaConfig(g) {
  const config = lerConfig();
  let mudou = false;
  for (const [campo, chave] of Object.entries(ESPELHO)) {
    if (g[campo] !== undefined && config[chave] !== g[campo]) { config[chave] = g[campo]; mudou = true; }
  }
  if (!mudou) return;
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

function listar() { return carregarBruto().map(comEspelho); }
function buscar(id) {
  const g = carregarBruto().find((x) => x.id === Number(id));
  return g ? comEspelho(g) : null;
}

// ---- validação ----
function inteiro(v) { return typeof v === 'number' ? Number.isInteger(v) : (typeof v === 'string' && /^-?\d+$/.test(v.trim())); }

// Devolve { erro } ou { dados } (já limpos). "atual" = grupo existente (PUT).
function validar(corpo, atual, outros) {
  const c = corpo || {};
  const nome = String(c.nome || '').trim();
  if (!nome) return { erro: 'Informe o nome do grupo.' };

  const whatsappId = String(c.whatsappId || '').trim();
  if (!whatsappId) return { erro: 'Escolha o grupo do WhatsApp.' };
  if (outros.some((g) => g.whatsappId === whatsappId)) {
    return { erro: 'Esse grupo do WhatsApp já está cadastrado.' };
  }

  for (const campo of ['horarioInicio', 'horarioFim']) {
    if (!inteiro(c[campo]) || Number(c[campo]) < 0 || Number(c[campo]) > 23) {
      return { erro: 'Horário inválido: use números de 0 a 23.' };
    }
  }
  const horarioInicio = Number(c.horarioInicio);
  const horarioFim = Number(c.horarioFim);
  if (horarioInicio >= horarioFim) return { erro: 'O horário de início deve ser menor que o de fim.' };

  if (!inteiro(c.produtosPorHora) || Number(c.produtosPorHora) < 1) {
    return { erro: 'Produtos por hora deve ser 1 ou mais.' };
  }
  if (!inteiro(c.intervaloRepeticaoHoras) || Number(c.intervaloRepeticaoHoras) < 1) {
    return { erro: 'O intervalo de repetição deve ser de 1 hora ou mais.' };
  }
  const conviteACada = c.conviteACada === undefined || c.conviteACada === null || c.conviteACada === '' ? 15 : c.conviteACada;
  if (!inteiro(conviteACada) || Number(conviteACada) < 0) {
    return { erro: 'O convite "a cada N ofertas" deve ser um número (0 desliga).' };
  }

  const linkConvite = String(c.linkConvite || '').trim();
  if (linkConvite && !/^https?:\/\//i.test(linkConvite)) {
    return { erro: 'O link de convite deve começar com https://' };
  }

  let categorias = c.categorias === undefined || c.categorias === null ? [] : c.categorias;
  if (!Array.isArray(categorias) || categorias.some((x) => typeof x !== 'string')) {
    return { erro: 'As categorias devem ser uma lista de textos.' };
  }
  categorias = [...new Set(categorias.map((x) => x.trim()).filter(Boolean))];

  const ativo = c.ativo === undefined ? (atual ? atual.ativo : true) : c.ativo;
  if (typeof ativo !== 'boolean') return { erro: 'O campo "ativo" deve ser verdadeiro ou falso.' };

  return {
    dados: {
      nome, whatsappId, linkConvite, categorias,
      horarioInicio, horarioFim,
      produtosPorHora: Number(c.produtosPorHora),
      intervaloRepeticaoHoras: Number(c.intervaloRepeticaoHoras),
      conviteACada: Number(conviteACada),
      ativo
    }
  };
}

function criar(corpo) {
  const lista = carregarBruto();
  const v = validar(corpo, null, lista);
  if (v.erro) return { erro: v.erro };
  const id = lista.reduce((m, g) => Math.max(m, g.id), 0) + 1;
  const grupo = { id, ...v.dados };
  lista.push(grupo);
  gravar(lista);
  if (ehPrincipal(grupo)) espelharParaConfig(grupo);
  return { grupo: comEspelho(grupo) };
}

function editar(id, corpo) {
  const lista = carregarBruto();
  const i = lista.findIndex((g) => g.id === Number(id));
  if (i === -1) return { naoEncontrado: true };
  const v = validar(corpo, lista[i], lista.filter((g) => g.id !== lista[i].id));
  if (v.erro) return { erro: v.erro };
  lista[i] = { id: lista[i].id, ...v.dados };
  gravar(lista);
  if (ehPrincipal(lista[i])) espelharParaConfig(lista[i]);
  return { grupo: comEspelho(lista[i]) };
}

function definirStatus(id, ativo) {
  if (typeof ativo !== 'boolean') return { erro: 'Informe "ativo" como verdadeiro ou falso.' };
  const lista = carregarBruto();
  const g = lista.find((x) => x.id === Number(id));
  if (!g) return { naoEncontrado: true };
  g.ativo = ativo;
  gravar(lista);
  return { grupo: comEspelho(g) };
}

function remover(id) {
  const lista = carregarBruto();
  const i = lista.findIndex((g) => g.id === Number(id));
  if (i === -1) return { naoEncontrado: true };
  if (lista.length <= 1) return { erro: 'Não dá para remover o último grupo.' };
  lista.splice(i, 1);
  gravar(lista);
  return { ok: true };
}

module.exports = { definirPrincipal, listar, buscar, criar, editar, definirStatus, remover, ehPrincipal };
