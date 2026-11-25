// Rotas de grupos (todas atrás do login, que o index.js já exige).
//   /api/grupos            lista, cria, edita, pausa, remove
//   /api/whatsapp/grupos-disponiveis
//   /api/categorias
// Erros: { sucesso: false, mensagem }.
const express = require('express');
const grupos = require('../grupos');
const estado = require('../robo-estado');
const { listarProdutos } = require('../produtos');

const router = express.Router();
const whatsapp = express.Router();
const categorias = express.Router();

const norm = (s) => String(s || '').trim().toLowerCase();

function resumoDe(g, config) {
  const filtro = (g.categorias || []).map(norm);
  const ofertasDisponiveis = listarProdutos().filter(
    (p) => p.ativo && (filtro.length === 0 || filtro.includes(norm(p.categoria)))
  ).length;

  // Até a Etapa 2b só o grupo principal posta de verdade.
  const principal = grupos.ehPrincipal(g);
  const e = principal ? estado.lerEstado() : { postadasHoje: 0, ultimaPostagem: null };

  const h = new Date().getHours();
  const dentro = h >= g.horarioInicio && h < g.horarioFim;
  const postando = principal && g.ativo && config.sistemaAtivo !== false && dentro;

  return {
    ofertasDisponiveis,
    postadasHoje: e.postadasHoje,
    ultimaPostagem: e.ultimaPostagem,
    proximaPostagem: postando ? estado.proximaPostagem({ ...config, horarioInicio: g.horarioInicio, horarioFim: g.horarioFim }) : null
  };
}

function completo(g) {
  return { ...g, resumo: resumoDe(g, estado.lerConfig()) };
}

const erro = (res, status, mensagem) => res.status(status).json({ sucesso: false, mensagem });

function guard(fn) {
  return (req, res) => {
    try { return fn(req, res); } catch (e) {
      console.error('❌ Rota de grupos:', e.message || e);
      return erro(res, 500, 'Erro interno ao tratar os grupos.');
    }
  };
}

router.get('/', guard((req, res) => res.json(grupos.listar().map(completo))));

router.get('/:id', guard((req, res) => {
  const g = grupos.buscar(req.params.id);
  if (!g) return erro(res, 404, 'Grupo não encontrado.');
  res.json(completo(g));
}));

router.post('/', guard((req, res) => {
  const r = grupos.criar(req.body);
  if (r.erro) return erro(res, 400, r.erro);
  res.json({ sucesso: true, grupo: completo(r.grupo) });
}));

router.put('/:id', guard((req, res) => {
  const r = grupos.editar(req.params.id, req.body);
  if (r.naoEncontrado) return erro(res, 404, 'Grupo não encontrado.');
  if (r.erro) return erro(res, 400, r.erro);
  res.json({ sucesso: true, grupo: completo(r.grupo) });
}));

router.patch('/:id/status', guard((req, res) => {
  const r = grupos.definirStatus(req.params.id, req.body ? req.body.ativo : undefined);
  if (r.naoEncontrado) return erro(res, 404, 'Grupo não encontrado.');
  if (r.erro) return erro(res, 400, r.erro);
  res.json({ sucesso: true, grupo: completo(r.grupo) });
}));

router.delete('/:id', guard((req, res) => {
  const r = grupos.remover(req.params.id);
  if (r.naoEncontrado) return erro(res, 404, 'Grupo não encontrado.');
  if (r.erro) return erro(res, 400, r.erro);
  res.json({ sucesso: true });
}));

// Grupos em que o número do robô está (cache de 60 s para não pesar no Chrome).
let cacheGrupos = { em: 0, lista: null };
whatsapp.get('/grupos-disponiveis', async (req, res) => {
  const lig = estado.obterLigacoes();
  if (!lig) return erro(res, 503, 'O robô ainda está iniciando. Tente em instantes.');
  if (cacheGrupos.lista && Date.now() - cacheGrupos.em < 60 * 1000) return res.json(cacheGrupos.lista);
  try {
    const chats = await lig.comTimeout(lig.client.getChats(), 25 * 1000, 'listar os grupos do WhatsApp');
    const lista = chats
      .filter((c) => c.isGroup)
      .map((c) => ({ whatsappId: c.id._serialized, nome: c.name }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    cacheGrupos = { em: Date.now(), lista };
    res.json(lista);
  } catch (e) {
    console.error('⚠️ grupos-disponiveis:', e.message || e);
    erro(res, 503, 'Não consegui listar os grupos do WhatsApp agora. Verifique se o robô está conectado.');
  }
});

categorias.get('/', guard((req, res) => {
  const mapa = new Map();
  for (const p of listarProdutos()) {
    const nome = String(p.categoria || '').trim();
    if (!nome) continue;
    const item = mapa.get(nome) || { nome, total: 0, ativos: 0 };
    item.total += 1;
    if (p.ativo) item.ativos += 1;
    mapa.set(nome, item);
  }
  res.json([...mapa.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR')));
}));

module.exports = { grupos: router, whatsapp, categorias };
