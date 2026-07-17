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
// Chama o Gemini, tentando de novo em caso de sobrecarga (503),
// e caindo para um modelo alternativo se o principal continuar instável
// ======================================
async function chamarGeminiComRetentativas(ai, prompt) {

    const modelos = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

    let ultimoErro;

    for (const modelo of modelos) {

        for (let tentativa = 1; tentativa <= 3; tentativa++) {

            try {

                console.log(`🤖 Chamando ${modelo} (tentativa ${tentativa}/3)...`);

                return await ai.models.generateContent({
                    model: modelo,
                    contents: prompt,
                    config: {
                        tools: [{ urlContext: {} }]
                    }
                });

            } catch (erro) {

                ultimoErro = erro;

                const eSobrecarga = erro.status === 503 || (erro.message && erro.message.includes('UNAVAILABLE'));

                if (eSobrecarga && tentativa < 3) {
                    console.log(`⏳ ${modelo} sobrecarregado, tentando de novo (${tentativa}/3)...`);
                    await new Promise(resolve => setTimeout(resolve, tentativa * 3000));
                    continue;
                }

                if (eSobrecarga) {
                    console.log(`⚠️ ${modelo} continua sobrecarregado após 3 tentativas. Tentando modelo alternativo...`);
                    break;
                }

                throw erro;

            }

        }

    }

    throw ultimoErro;

}

// ======================================
// EXTRAIR PRODUTOS DE UM LINK, VIA IA
// ======================================
router.post('/extrair', async (req, res) => {

    try {

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

        const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

        const prompt = `
Acesse esta página do Mercado Livre: ${link}

Extraia TODOS os produtos únicos que aparecem na lista, seguindo estas regras obrigatórias:

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

        const resposta = await chamarGeminiComRetentativas(ai, prompt);

        let textoResposta = resposta.text.trim();

        // Remove marcadores de código, caso a IA ainda mande mesmo pedindo pra não mandar
        textoResposta = textoResposta.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

        let produtos;

        try {
            produtos = JSON.parse(textoResposta);
        } catch (erroParse) {
            return res.status(500).json({
                sucesso: false,
                mensagem: 'A IA retornou um formato inválido. Tente novamente.'
            });
        }

        // Confere cada link antes de devolver pro Dashboard
        for (const produto of produtos) {

            if (!produto.linkOriginal || produto.linkOriginal === 'LINK_NAO_CONFIRMADO') {
                produto.linkVerificado = false;
                continue;
            }

            produto.linkVerificado = await verificarLink(produto.linkOriginal);

        }

        res.json({
            sucesso: true,
            produtos: produtos
        });

    } catch (erro) {

        console.error('Erro ao extrair produtos com IA:', erro);

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao processar o link com a IA. O Gemini pode estar temporariamente sobrecarregado — tente novamente em alguns minutos.'
        });

    }

});

module.exports = router;
