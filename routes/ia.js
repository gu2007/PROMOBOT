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
// Chama o Gemini EM STREAMING, tentando de novo em caso de sobrecarga (503),
// e caindo para um modelo alternativo se o principal continuar instável
// OU se a cota diária dele esgotar (429).
// Vai mandando cada pedaço de texto pro navegador conforme chega.
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

                // Sobrecarga momentânea (503): vale tentar de novo no mesmo modelo
                if (eSobrecarga && tentativa < 3) {
                    console.log(`⏳ ${modelo} sobrecarregado, tentando de novo (${tentativa}/3)...`);
                    enviarEvento(res, 'status', { mensagem: `${modelo} sobrecarregado, tentando de novo (${tentativa}/3)...` });
                    await new Promise(resolve => setTimeout(resolve, tentativa * 3000));
                    continue;
                }

                // Cota diária esgotada (429): não adianta tentar de novo no mesmo modelo,
                // pula direto para o próximo modelo da lista.
                if (eCotaEsgotada) {
                    console.log(`⚠️ Cota diária de ${modelo} esgotada. Tentando modelo alternativo...`);
                    enviarEvento(res, 'status', { mensagem: `Cota diária de ${modelo} esgotada. Tentando modelo alternativo...` });
                    break;
                }

                // Sobrecarga que persistiu após as 3 tentativas: também troca de modelo
                if (eSobrecarga) {
                    console.log(`⚠️ ${modelo} continua sobrecarregado após 3 tentativas. Tentando modelo alternativo...`);
                    enviarEvento(res, 'status', { mensagem: `${modelo} continua instável. Tentando modelo alternativo...` });
                    break;
                }

                // Qualquer outro erro (não é sobrecarga nem cota): não adianta insistir
                throw erro;

            }

        }

    }

    throw ultimoErro;

}

// ======================================
// EXTRAIR PRODUTOS DE UM LINK, VIA IA (com streaming)
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

    // A partir daqui, a resposta vira uma transmissão contínua (SSE)
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

3. LINK: copie o link EXATO do anúncio, igual ao atributo href do elemento daquele produto na página. Não crie, não complete e não deduza nenhuma parte do link. Se não tiver certeza absoluta, preencha "linkOriginal" com "LINK_NAO_CONFIRMADO" e explique em "observacao".

4. Retorne EXATAMENTE neste formato JSON (mesmos nomes de campos):

[
  {
    "marketplace": "mercadolivre",
    "categoria": "string",
    "marca": "string ou null",
    "titulo": "string",
    "preco": número,
    "precoAntigo": número ou null,
    "desconto": número ou null,
    "avaliacao": número ou null,
    "vendidos": número ou null,
    "linkOriginal": "string",
    "texto": "string, texto de venda persuasivo em português, até 200 caracteres",
    "observacao": "string ou null"
  }
]

Retorne apenas o array JSON, sem nenhum texto antes ou depois, sem marcadores de código.
`;

        const textoResposta = await chamarGeminiComStreamETentativas(ai, prompt, res);

        let textoLimpo = textoResposta.trim();

        // Remove marcadores de código, caso a IA ainda mande mesmo pedindo pra não mandar
        textoLimpo = textoLimpo.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

        let produtos;

        try {
            produtos = JSON.parse(textoLimpo);
        } catch (erroParse) {
            enviarEvento(res, 'erro', { mensagem: 'A IA retornou um formato inválido. Tente novamente.' });
            return res.end();
        }

        enviarEvento(res, 'status', { mensagem: 'Conferindo os links dos produtos encontrados...' });

        // Confere cada link antes de devolver pro Dashboard
        for (const produto of produtos) {

            if (!produto.linkOriginal || produto.linkOriginal === 'LINK_NAO_CONFIRMADO') {
                produto.linkVerificado = false;
                continue;
            }

            produto.linkVerificado = await verificarLink(produto.linkOriginal);

        }

        enviarEvento(res, 'final', { sucesso: true, produtos });

        res.end();

    } catch (erro) {

        console.error('Erro ao extrair produtos com IA:', erro);

        const eCotaEsgotada = erro.status === 429 || (erro.message && erro.message.includes('RESOURCE_EXHAUSTED'));

        enviarEvento(res, 'erro', {
            mensagem: eCotaEsgotada
                ? 'A cota diária gratuita de todos os modelos disponíveis foi esgotada. Tente novamente amanhã, ou ative a cobrança no Google Cloud para aumentar o limite.'
                : 'Erro ao processar o link com a IA. O Gemini pode estar temporariamente sobrecarregado — tente novamente em alguns minutos.'
        });

        res.end();

    }

});

module.exports = router;
