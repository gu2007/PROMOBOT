const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function carregarConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// ======================================
// Manda um evento no formato SSE (Server-Sent Events) para o navegador
// ======================================
function enviarEvento(res, tipo, dados) {
    res.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
}

// ======================================
// Confere se um link ainda existe e não caiu
// numa página de "produto indisponível"
// ======================================
async function verificarLink(url) {

    try {

        const resposta = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!resposta.ok) {
            return false;
        }

        const html = await resposta.text();

        const padroesIndisponivel = [
            /publica[çc][ãa]o pausada/i,
            /produto pausado/i,
            /n[ãa]o est[áa] mais dispon[íi]vel/i,
            /este produto n[ãa]o existe/i
        ];

        return !padroesIndisponivel.some(padrao => padrao.test(html));

    } catch (erro) {

        return false;

    }

}

// ======================================
// Chama o Gemini, tentando de novo em caso de sobrecarga (503)
// e caindo para um modelo alternativo se o principal continuar instável
// ou se a cota diária dele esgotar (429).
// ======================================
async function chamarGeminiComTentativas(ai, modelos, params) {

    let ultimoErro;

    for (const modelo of modelos) {

        for (let tentativa = 1; tentativa <= 3; tentativa++) {

            try {

                return await ai.models.generateContent({
                    model: modelo,
                    ...params
                });

            } catch (erro) {

                ultimoErro = erro;

                const eSobrecarga = erro.status === 503 || (erro.message && erro.message.includes('UNAVAILABLE'));
                const eCotaEsgotada = erro.status === 429 || (erro.message && erro.message.includes('RESOURCE_EXHAUSTED'));

                if (eSobrecarga && tentativa < 3) {
                    await new Promise(resolve => setTimeout(resolve, tentativa * 3000));
                    continue;
                }

                if (eSobrecarga || eCotaEsgotada) {
                    break;
                }

                throw erro;

            }

        }

    }

    throw ultimoErro;

}

// ======================================
// Versão em streaming, usada só na Etapa 1 (extração da página)
// ======================================
async function chamarGeminiComStreamETentativas(ai, prompt, res) {

    const modelos = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

    let ultimoErro;

    for (const modelo of modelos) {

        for (let tentativa = 1; tentativa <= 3; tentativa++) {

            try {

                console.log(`🤖 Chamando ${modelo} em streaming (tentativa ${tentativa}/3)...`);
                enviarEvento(res, 'status', { mensagem: `Consultando ${modelo}...` });

                const streamResponse = await ai.models.generateContentStream({
                    model: modelo,
                    contents: prompt,
                    config: {
                        tools: [{ urlContext: {} }]
                    }
                });

                let textoAcumulado = '';

                for await (const chunk of streamResponse) {

                    const trecho = chunk.text || '';

                    if (trecho) {
                        textoAcumulado += trecho;
                        enviarEvento(res, 'trecho', { texto: trecho });
                    }

                }

                if (textoAcumulado.trim() === '') {
                    throw new Error('Resposta vazia do modelo.');
                }

                return textoAcumulado;

            } catch (erro) {

                ultimoErro = erro;

                const eSobrecarga = erro.status === 503 || (erro.message && erro.message.includes('UNAVAILABLE'));
                const eCotaEsgotada = erro.status === 429 || (erro.message && erro.message.includes('RESOURCE_EXHAUSTED'));

                if (eSobrecarga && tentativa < 3) {
                    enviarEvento(res, 'status', { mensagem: `${modelo} sobrecarregado, tentando de novo (${tentativa}/3)...` });
                    await new Promise(resolve => setTimeout(resolve, tentativa * 3000));
                    continue;
                }

                if (eCotaEsgotada) {
                    enviarEvento(res, 'status', { mensagem: `Cota diária de ${modelo} esgotada. Tentando modelo alternativo...` });
                    break;
                }

                if (eSobrecarga) {
                    enviarEvento(res, 'status', { mensagem: `${modelo} continua instável. Tentando modelo alternativo...` });
                    break;
                }

                throw erro;

            }

        }

    }

    throw ultimoErro;

}

// ======================================
// ETAPA 1 — EXTRAIR PRODUTOS DE UM LINK (sem tentar achar link de cada produto)
// ======================================
router.post('/extrair', async (req, res) => {

    const { link } = req.body;

    if (!link) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Informe um link para extrair os produtos.'
        });
    }

    const config = carregarConfig();

    if (!config.gemini || !config.gemini.apiKey) {
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Chave da API do Gemini não configurada.'
        });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {

        const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

        const prompt = `
Acesse esta página do Mercado Livre: ${link}

Extraia 10 produtos únicos que aparecem na lista, seguindo estas regras obrigatórias:

1. DEDUPLICAÇÃO: se o mesmo produto aparecer sendo vendido por vendedores diferentes, escolha apenas UMA ocorrência — a de melhor preço ou maior desconto.

2. DIVERSIDADE: não repita o mesmo tipo de produto. Se houver várias opções do mesmo tipo (ex: várias furadeiras), escolha só a de melhor oferta, priorizando diversidade entre tipos de produto.

3. NÃO inclua nenhum link nesta etapa — isso será feito separadamente depois. Foque só em extrair os dados com precisão.

4. Retorne EXATAMENTE neste formato JSON (mesmos nomes de campos):

[
  {
    "marketplace": "mercadolivre",
    "categoria": "string",
    "marca": "string ou null",
    "titulo": "string, o título completo e exato do anúncio",
    "preco": número,
    "precoAntigo": número ou null,
    "desconto": número ou null,
    "avaliacao": número ou null,
    "vendidos": número ou null,
    "texto": "string, texto de venda persuasivo em português, até 200 caracteres"
  }
]

Retorne apenas o array JSON, sem nenhum texto antes ou depois, sem marcadores de código.
`;

        const textoResposta = await chamarGeminiComStreamETentativas(ai, prompt, res);

        let textoLimpo = textoResposta.trim();

        textoLimpo = textoLimpo.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

        let produtos;

        try {
            produtos = JSON.parse(textoLimpo);
        } catch (erroParse) {
            enviarEvento(res, 'erro', { mensagem: 'A IA retornou um formato inválido. Tente novamente.' });
            return res.end();
        }

        // Nesta etapa, todo produto ainda não tem link — marca como pendente
        produtos.forEach(produto => {
            produto.linkOriginal = null;
            produto.linkVerificado = false;
        });

        enviarEvento(res, 'final', { sucesso: true, produtos });

        res.end();

    } catch (erro) {

        console.error('Erro ao extrair produtos com IA:', erro);

        const eCotaEsgotada = erro.status === 429 || (erro.message && erro.message.includes('RESOURCE_EXHAUSTED'));

        enviarEvento(res, 'erro', {
            mensagem: eCotaEsgotada
                ? 'A cota diária gratuita de todos os modelos disponíveis foi esgotada. Tente novamente amanhã, ou verifique seu saldo no Google Cloud.'
                : 'Erro ao processar o link com a IA. O Gemini pode estar temporariamente sobrecarregado — tente novamente em alguns minutos.'
        });

        res.end();

    }

});

// ======================================
// ETAPA 2 — BUSCAR O LINK DE UM PRODUTO ESPECÍFICO (chamada pequena e focada)
// ======================================
router.post('/buscar-link', async (req, res) => {

    try {

        const { titulo, marca, preco, marketplace } = req.body;

        if (!titulo) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Informe o título do produto.'
            });
        }

        const config = carregarConfig();

        if (!config.gemini || !config.gemini.apiKey) {
            return res.status(500).json({
                sucesso: false,
                mensagem: 'Chave da API do Gemini não configurada.'
            });
        }

        const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

        const site = (marketplace || 'mercadolivre').toLowerCase().includes('mercado')
            ? 'mercadolivre.com.br'
            : (marketplace || '').toLowerCase();

        const prompt = `
Busque no Google o link EXATO da página do anúncio deste produto específico (não uma página de busca ou lista com vários produtos), preferencialmente no site ${site}:

Título: "${titulo}"
${marca ? `Marca: "${marca}"` : ''}
${preco ? `Preço aproximado: R$ ${preco}` : ''}

Um link correto de anúncio do Mercado Livre geralmente contém "/MLB" seguido de números (exemplos: mercadolivre.com.br/p/MLB12345678 ou mercadolivre.com.br/produto-nome/MLB-12345678). NUNCA retorne um link de busca ou lista (que costuma começar com "lista.mercadolivre.com.br" ou conter "?q=" ou "/busca").

Retorne no seguinte formato JSON, sem nenhum texto antes ou depois, sem marcadores de código:

{
  "link": "a URL completa mais provável para esse produto, mesmo que você não tenha certeza absoluta",
  "confianca": "alta ou baixa"
}

Nunca deixe o campo "link" vazio — sempre retorne a melhor URL que você conseguir encontrar, mesmo que a confiança seja baixa.
`;

        const resposta = await chamarGeminiComTentativas(
            ai,
            ['gemini-3.1-flash-lite', 'gemini-3.5-flash'],
            {
                contents: prompt,
                config: {
                    tools: [{ googleSearch: {} }]
                }
            }
        );

        let textoResposta = (resposta.text || '').trim();
        textoResposta = textoResposta.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

        let link = null;
        let confianca = 'baixa';

        try {
            const dadosResposta = JSON.parse(textoResposta);
            link = dadosResposta.link || null;
            confianca = dadosResposta.confianca === 'alta' ? 'alta' : 'baixa';
        } catch (erroParse) {
            // Se não veio em JSON, tenta extrair qualquer URL do texto como plano B
            const match = textoResposta.match(/https?:\/\/\S+/);
            link = match ? match[0].replace(/[.,;)\]]+$/, '') : null;
        }

        // Rebaixa a confiança automaticamente se parecer uma página de busca/lista, não um produto específico
        const pareceListaOuBusca = link && (
            link.includes('lista.mercadolivre') ||
            link.includes('/busca') ||
            link.includes('?q=')
        );

        if (pareceListaOuBusca) {
            confianca = 'baixa';
        }

        const linkVerificado = link
            ? await verificarLink(link)
            : false;

        res.json({
            sucesso: true,
            link: link,
            confianca: confianca,
            linkVerificado: linkVerificado
        });

    } catch (erro) {

        console.error('Erro ao buscar link do produto:', erro);

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao buscar o link deste produto.'
        });

    }

});

module.exports = router;
