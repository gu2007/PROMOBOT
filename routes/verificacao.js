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

Diga se o produto ainda está disponível para compra (não removido, não esgotado) e qual é o preço atual dele.

Retorne APENAS este JSON, sem nenhum texto antes ou depois, sem marcadores de código:

{
  "disponivel": true ou false,
  "preco": número (preço atual, sem símbolo de moeda) ou null se não conseguir ler
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
// Roda a verificação em TODOS os produtos ativos, um de cada vez,
// com uma pequena pausa entre eles pra não estourar limite de requisições.
// ======================================
async function rodarVerificacaoSemanal() {

    const resumo = {
        totalVerificados: 0,
        alteracoesEncontradas: 0,
        falhas: 0,
        detalhes: []
    };

    let apiKey;

    try {
        apiKey = obterChaveGemini();
    } catch (erro) {
        console.error('❌ Verificação semanal abortada:', erro.message);
        resumo.erro = erro.message;
        return resumo;
    }

    const ai = new GoogleGenAI({ apiKey });

    const produtosAtivos = listarProdutosAtivos().filter(
        p => p.linkAfiliado && p.linkAfiliado !== 'LINK_NAO_CONFIRMADO'
    );

    console.log(`🔎 Verificação semanal iniciada: ${produtosAtivos.length} produto(s) ativo(s) para checar.`);

    for (const produto of produtosAtivos) {

        try {

            const resultado = await verificarProdutoUnico(ai, produto);

            resumo.totalVerificados++;

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

    console.log(`✅ Verificação semanal concluída: ${resumo.totalVerificados} verificado(s), ${resumo.alteracoesEncontradas} alteração(ões), ${resumo.falhas} falha(s).`);

    return resumo;

}

// ======================================
// Rota manual, pra testar a verificação sem esperar a semana passar
// ======================================
router.post('/rodar-agora', async (req, res) => {

    try {

        const resumo = await rodarVerificacaoSemanal();
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