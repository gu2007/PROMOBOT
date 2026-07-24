const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const {
    listarProdutosAtivos,
    aplicarResultadoVerificacao
} = require('../produtos');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function carregarConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function obterChaveGemini() {
    const config = carregarConfig();
    if (!config.gemini || !config.gemini.apiKey) {
        throw new Error('Chave da API do Gemini não configurada.');
    }
    return config.gemini.apiKey;
}

// ======================================
// Consulta a IA sobre UM produto: ainda está disponível? qual o preço atual?
// (usa a mesma ferramenta de leitura de página já usada na importação por link)
// ======================================
async function verificarProdutoUnico(ai, produto) {

    const prompt = `Acesse esta página de produto: ${produto.linkAfiliado}

Sua tarefa tem duas partes:

1. Primeiro, avalie se você CONSEGUIU acessar e ler o conteúdo real da página do produto. Isso é diferente de "achar que está indisponível" — se a página não carregou, redirecionou para uma tela de verificação/erro/bloqueio, mostrou captcha, ou você não tem certeza do que está vendo, isso conta como NÃO CONSEGUIU ACESSAR, mesmo que pareça sutilmente com uma página de "produto esgotado".

2. Só se você TEVE CERTEZA de que acessou a página real do produto, diga se ele está disponível para compra e qual o preço atual.

REGRA CRÍTICA: nunca assuma "indisponível" como suposição ou chute. "Indisponível" só deve ser reportado se a própria página do produto mostrar EXPLICITAMENTE uma mensagem como "produto esgotado", "anúncio pausado", "produto não encontrado" ou equivalente. Qualquer dúvida = NÃO CONSEGUIU ACESSAR.

Retorne APENAS este JSON, sem nenhum texto antes ou depois, sem marcadores de código:

{
  "conseguiuAcessar": true ou false,
  "disponivel": true ou false ou null (null se conseguiuAcessar for false),
  "preco": número (preço atual, sem símbolo de moeda) ou null
}`;

    const resposta = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: { tools: [{ urlContext: {} }] }
    });

    let texto = (resposta.text || '').trim();
    texto = texto.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

    return JSON.parse(texto);

}

// ======================================
// Roda a verificação nos produtos ativos, um de cada vez, com uma pequena
// pausa entre eles pra não estourar limite de requisições.
// Se "idsEspecificos" for informado, verifica só esses produtos (útil pra
// testar em poucos produtos antes de rodar em todo o catálogo).
// ======================================
async function rodarVerificacaoSemanal(idsEspecificos) {

    const resumo = {
        totalVerificados: 0,
        alteracoesEncontradas: 0,
        naoConseguiuAcessar: 0,
        falhas: 0,
        detalhes: []
    };

    let apiKey;

    try {
        apiKey = obterChaveGemini();
    } catch (erro) {
        console.error('❌ Verificação abortada:', erro.message);
        resumo.erro = erro.message;
        return resumo;
    }

    const ai = new GoogleGenAI({ apiKey });

    let produtosParaChecar = listarProdutosAtivos().filter(
        p => p.linkAfiliado && p.linkAfiliado !== 'LINK_NAO_CONFIRMADO'
    );

    if (Array.isArray(idsEspecificos) && idsEspecificos.length > 0) {
        const idsSet = new Set(idsEspecificos.map(Number));
        produtosParaChecar = produtosParaChecar.filter(p => idsSet.has(p.id));
    }

    console.log(`🔎 Verificação iniciada: ${produtosParaChecar.length} produto(s) para checar.`);

    for (const produto of produtosParaChecar) {

        try {

            const resultado = await verificarProdutoUnico(ai, produto);

            resumo.totalVerificados++;

            if (resultado.conseguiuAcessar !== true) {

                resumo.naoConseguiuAcessar++;
                console.log(`ℹ️ Produto #${produto.id} não pôde ser confirmado (link bloqueado/inacessível), nada foi alterado: ${produto.titulo.slice(0, 50)}`);
                continue;

            }

            const precoAntes = produto.preco;

            aplicarResultadoVerificacao(produto.id, resultado);

            if (resultado.disponivel === false) {

                resumo.alteracoesEncontradas++;
                resumo.detalhes.push(`#${produto.id} ficou indisponível: ${produto.titulo.slice(0, 50)}`);
                console.log(`⚠️ Produto #${produto.id} indisponível, desativado: ${produto.titulo.slice(0, 50)}`);

            } else if (typeof resultado.preco === 'number' && Math.abs(resultado.preco - precoAntes) / Math.max(resultado.preco, precoAntes) >= 0.10) {

                resumo.alteracoesEncontradas++;
                resumo.detalhes.push(`#${produto.id} preço mudou de R$${precoAntes} para R$${resultado.preco}: ${produto.titulo.slice(0, 50)}`);
                console.log(`💰 Produto #${produto.id} preço atualizado: R$${precoAntes} -> R$${resultado.preco}`);

            }

        } catch (erro) {

            resumo.falhas++;
            console.error(`❌ Falha ao verificar produto #${produto.id}:`, erro.message);

        }

        // Pequena pausa entre cada chamada pra não estourar limite de requisições por minuto
        await new Promise(resolve => setTimeout(resolve, 4000));

    }

    console.log(`✅ Verificação concluída: ${resumo.totalVerificados} verificado(s), ${resumo.alteracoesEncontradas} alteração(ões), ${resumo.naoConseguiuAcessar} não confirmado(s), ${resumo.falhas} falha(s).`);

    return resumo;

}

// ======================================
// Rota manual, pra testar a verificação sem esperar a semana passar.
// Aceita { produtoIds: [1, 2] } no corpo pra testar só em alguns produtos.
// ======================================
router.post('/rodar-agora', async (req, res) => {

    try {

        const idsEspecificos = req.body && Array.isArray(req.body.produtoIds) ? req.body.produtoIds : null;
        const resumo = await rodarVerificacaoSemanal(idsEspecificos);
        res.json({ sucesso: true, resumo });

    } catch (erro) {

        console.error('Erro ao rodar verificação manual:', erro);
        res.status(500).json({ sucesso: false, mensagem: erro.message });

    }

});

module.exports = {
    router,
    rodarVerificacaoSemanal
};