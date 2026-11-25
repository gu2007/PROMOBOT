// Rotas do painel para o robô:
//   GET  /api/robo/resumo            -> números do topo do painel
//   POST /api/produtos/:id/postar    -> "Postar agora" (1 produto, 1 grupo)
// Erros sempre no formato { sucesso: false, mensagem }.
const express = require('express');
const estado = require('../robo-estado');
const { buscarProduto, registrarEnvio } = require('../produtos');

const robo = express.Router();
const produtosExtra = express.Router();

robo.get('/resumo', async (req, res) => {
  try {
    res.json(await estado.resumo());
  } catch (erro) {
    res.status(500).json({ sucesso: false, mensagem: 'Não consegui montar o resumo do robô.' });
  }
});

// Só existe um grupo até a Etapa 2 (vários grupos) ser entregue. Aceita sem
// grupoId, ou com o id do grupo principal.
function grupoPermitido(grupoId, groupIdPrincipal) {
  if (grupoId === undefined || grupoId === null || grupoId === '') return true;
  return grupoId === 'principal' || grupoId === groupIdPrincipal;
}

produtosExtra.post('/:id/postar', async (req, res) => {
  const lig = estado.obterLigacoes();
  if (!lig) {
    return res.status(503).json({ sucesso: false, mensagem: 'O robô ainda está iniciando. Tente em instantes.' });
  }

  const id = Number(req.params.id);
  const produto = Number.isFinite(id) ? buscarProduto(id) : null;

  if (!produto) {
    return res.status(404).json({ sucesso: false, mensagem: 'Produto não encontrado.' });
  }
  if (!produto.ativo) {
    return res.status(400).json({ sucesso: false, mensagem: 'Este produto está inativo. Ative-o antes de postar.' });
  }
  if (!/^https?:\/\//i.test(String(produto.linkAfiliado || ''))) {
    return res.status(400).json({ sucesso: false, mensagem: 'Este produto não tem um link de afiliado válido.' });
  }

  const grupoId = req.body ? req.body.grupoId : undefined;
  if (!grupoPermitido(grupoId, lig.groupId)) {
    return res.status(404).json({ sucesso: false, mensagem: 'Grupo não encontrado.' });
  }

  const conectado = (await estado.estadoWhatsApp()) === 'CONNECTED';
  if (!conectado) {
    return res.status(503).json({ sucesso: false, mensagem: 'O WhatsApp não está conectado agora. Tente novamente em alguns minutos.' });
  }

  try {
    await lig.enfileirar(() => lig.enviarProduto(lig.client, produto));
  } catch (erro) {
    console.error('❌ Postar agora falhou:', erro.message || erro);
    return res.status(500).json({ sucesso: false, mensagem: 'Não consegui enviar a mensagem: ' + (erro.message || 'erro desconhecido') });
  }

  try { registrarEnvio(produto.id); } catch (erro) {
    console.error('⚠️ Enviado, mas não consegui registrar o envio:', erro.message);
  }
  try { estado.registrarPostagem(); } catch (_) {}

  console.log(`✅ Postado manualmente pelo painel: ${produto.titulo}`);
  res.json({ sucesso: true, mensagem: 'Produto postado no grupo.', produtoId: produto.id });
});

module.exports = { robo, produtosExtra };
