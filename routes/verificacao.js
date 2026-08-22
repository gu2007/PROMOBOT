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
// e, se ainda não tivermos, qual a URL da foto principal do produto?
// Usa o "linkOriginal" (página direta do produto, sem afiliado) — já provamos
// que os links de afiliado encurtados (ex: meli.la/xxx, link.amazon/xxx)
// bloqueiam esse tipo de acesso automatizado, então essa verificação depende
// do linkOriginal estar preenchido no cadastro do produto.
// ======================================
async function verificarProdutoUnico(ai, produto) {

    const precisaDeImagem = !produto.imagem;

    const prompt = `Acesse esta página de produto: ${produto.linkOriginal}

Leia o título e o preço atual do produto diretamente na página.

Depois, verifique se existe alguma indicação EXPLÍCITA na própria página de que o produto não pode ser comprado agora — por exemplo textos como "produto esgotado", "anúncio pausado", "produto não encontrado" ou uma página de erro real. Se não houver nenhuma indicação assim, considere o produto disponível normalmente.

${precisaDeImagem ? 'Além disso, encontre a URL absoluta (começando com http:// ou https://) da imagem/foto principal do produto na página (a foto de capa do anúncio). Isso é usado só de forma informativa, não precisa ter certeza absoluta — se não encontrar uma URL de imagem clara, retorne null nesse campo.' : ''}

Retorne APENAS este JSON, sem nenhum texto antes ou depois, sem marcadores de código:

{
  "conseguiuAcessar": true ou false (true se você conseguiu ler um título e preço reais da página; false só se a página realmente não carregou, foi bloqueada, ou mostrou captcha/erro),
  "disponivel": true ou false (false apenas se a página mostrar explicitamente que o produto está esgotado/pausado/removido),
  "preco": número (preço atual, sem símbolo de moeda) ou null,
  "imagemUrl": ${precisaDeImagem ? 'string com a URL da imagem principal, ou null se não encontrar' : 'null (não precisa buscar, já temos a imagem deste produto)'}
}`;

    const streamResponse = await ai.models.generateContentStream({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: { tools: [{ urlContext: {} }] }
    });

    let textoAcumulado = '';
    let ultimoChunk = null;

    for await (const chunk of streamResponse) {
        textoAcumulado += chunk.text || '';
        ultimoChunk = chunk;
    }

    // Log de diagnóstico: mostra o que a ferramenta de leitura de página
    // realmente conseguiu buscar, segundo o próprio Gemini (não depende
    // do que o modelo "acha" que aconteceu). Ajuda a diferenciar bloqueio
    // real de acesso de uma resposta conservadora demais do modelo.
    try {
        const metadados = ultimoChunk?.candidates?.[0]?.urlContextMetadata;
        console.log(`🔬 [diagnóstico] urlContextMetadata para "${produto.linkOriginal}":`, JSON.stringify(metadados));
    } catch (erroLog) {
        console.log('🔬 [diagnóstico] Não foi possível ler urlContextMetadata:', erroLog.message);
    }

    let texto = textoAcumulado.trim();
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
        semLinkOriginal: 0,
        imagensCapturadas: 0,
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

    let produtosAtivos = listarProdutosAtivos();

    if (Array.isArray(idsEspecificos) && idsEspecificos.length > 0) {
        const idsSet = new Set(idsEspecificos.map(Number));
        produtosAtivos = produtosAtivos.filter(p => idsSet.has(p.id));
    }

    const produtosParaChecar = produtosAtivos.filter(
        p => p.linkOriginal && p.linkOriginal.startsWith('http')
    );

    resumo.semLinkOriginal = produtosAtivos.length - produtosParaChecar.length;

    console.log(`🔎 Verificação iniciada: ${produtosParaChecar.length} produto(s) para checar (${resumo.semLinkOriginal} pulado(s) por não ter link original cadastrado).`);

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
            const jaTinhaImagemAntes = !!produto.imagem;

            aplicarResultadoVerificacao(produto.id, resultado);

            if (!jaTinhaImagemAntes && resultado.imagemUrl) {
                resumo.imagensCapturadas++;
                console.log(`🖼️ Produto #${produto.id} ganhou uma foto: ${produto.titulo.slice(0, 50)}`);
            }

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

    console.log(`✅ Verificação concluída: ${resumo.totalVerificados} verificado(s), ${resumo.alteracoesEncontradas} alteração(ões), ${resumo.imagensCapturadas} imagem(ns) capturada(s), ${resumo.naoConseguiuAcessar} não confirmado(s), ${resumo.semLinkOriginal} sem link original, ${resumo.falhas} falha(s).`);

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