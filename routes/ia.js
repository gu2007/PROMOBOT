const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mammoth = require('mammoth');
const { GoogleGenAI } = require('@google/genai');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // limite de 15MB por arquivo
});

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
// Prompt padrão usado nas 3 formas de extração
// (as instruções de formato de saída são as mesmas, só muda a fonte dos dados)
// ======================================
function montarInstrucoesFormato() {
    return `
Extraia até 10 produtos únicos, seguindo estas regras obrigatórias:

1. DEDUPLICAÇÃO: se o mesmo produto aparecer sendo vendido por vendedores diferentes, escolha apenas UMA ocorrência — a de melhor preço ou maior desconto.

2. DIVERSIDADE: não repita o mesmo tipo de produto. Se houver várias opções do mesmo tipo (ex: várias furadeiras), escolha só a de melhor oferta, priorizando diversidade entre tipos de produto.

3. IGNORE anúncios patrocinados/publicidade que não pareçam parte da lista principal de resultados, e ignore "outras opções de compra" secundárias do mesmo anúncio — considere só a oferta principal de cada produto.

4. Use SOMENTE os dados que você conseguir ver claramente na fonte fornecida. Se um campo não estiver visível ou você não tiver certeza, use null — nunca invente ou estime um valor.

5. NÃO inclua nenhum link nesta etapa — isso será feito separadamente pelo usuário depois.

6. MARKETPLACE: identifique corretamente de qual site cada produto veio, com base no conteúdo/URL da fonte fornecida. Use EXATAMENTE um destes três valores (nunca outro): "mercadolivre", "amazon" ou "shopee". Não copie um valor fixo — cada produto deve refletir o marketplace real de onde ele veio.

7. Retorne EXATAMENTE neste formato JSON (mesmos nomes de campos):

[
  {
    "marketplace": "mercadolivre, amazon ou shopee — conforme a fonte real",
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
}

// ======================================
// Processa a resposta bruta da IA e devolve um array de produtos limpo
// ======================================
function processarRespostaIA(textoResposta) {

    let textoLimpo = textoResposta.trim();

    textoLimpo = textoLimpo.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

    const produtos = JSON.parse(textoLimpo);

    produtos.forEach(produto => {
        produto.linkOriginal = '';
    });

    return produtos;

}

// ======================================
// Chama o Gemini em streaming, com retentativas em caso de sobrecarga (503)
// ou cota esgotada (429), trocando de modelo quando necessário
// ======================================
async function chamarGeminiComStreamETentativas(ai, params, res) {

    const modelos = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

    let ultimoErro;

    for (const modelo of modelos) {

        for (let tentativa = 1; tentativa <= 3; tentativa++) {

            try {

                console.log(`🤖 Chamando ${modelo} em streaming (tentativa ${tentativa}/3)...`);
                enviarEvento(res, 'status', { mensagem: `Consultando ${modelo}...` });

                const streamResponse = await ai.models.generateContentStream({
                    model: modelo,
                    ...params
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
// Prepara a conexão SSE e valida a chave do Gemini (usado pelas 3 rotas)
// ======================================
function prepararRespostaStream(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
}

function obterChaveGemini() {
    const config = carregarConfig();
    if (!config.gemini || !config.gemini.apiKey) {
        throw new Error('Chave da API do Gemini não configurada.');
    }
    return config.gemini.apiKey;
}

// ======================================
// FORMA 1 — EXTRAIR PRODUTOS DE UM LINK
// ======================================
router.post('/extrair', async (req, res) => {

    const { link } = req.body;

    if (!link) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Informe um link para extrair os produtos.'
        });
    }

    let apiKey;

    try {
        apiKey = obterChaveGemini();
    } catch (erro) {
        return res.status(500).json({ sucesso: false, mensagem: erro.message });
    }

    prepararRespostaStream(res);

    try {

        const ai = new GoogleGenAI({ apiKey });

        const prompt = `Acesse esta página do Mercado Livre: ${link}\n\n${montarInstrucoesFormato()}`;

        enviarEvento(res, 'prompt', { texto: prompt });

        const textoResposta = await chamarGeminiComStreamETentativas(ai, {
            contents: prompt,
            config: { tools: [{ urlContext: {} }] }
        }, res);

        const produtos = processarRespostaIA(textoResposta);

        enviarEvento(res, 'final', { sucesso: true, produtos });
        res.end();

    } catch (erro) {

        console.error('Erro ao extrair produtos (link):', erro);

        const eCotaEsgotada = erro.status === 429 || (erro.message && erro.message.includes('RESOURCE_EXHAUSTED'));

        enviarEvento(res, 'erro', {
            mensagem: eCotaEsgotada
                ? 'A cota diária gratuita de todos os modelos disponíveis foi esgotada, ou seu saldo pago acabou.'
                : (erro.message === 'Resposta vazia do modelo.' || erro.name === 'SyntaxError'
                    ? 'A IA retornou um formato inválido. Tente novamente.'
                    : 'Erro ao processar o link com a IA. Tente novamente em alguns minutos.')
        });

        res.end();

    }

});

// ======================================
// FORMA 2 — EXTRAIR PRODUTOS DE UM ARQUIVO (PDF ou Word)
// ======================================
router.post('/extrair-arquivo', upload.single('arquivo'), async (req, res) => {

    if (!req.file) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Envie um arquivo PDF ou Word.'
        });
    }

    let apiKey;

    try {
        apiKey = obterChaveGemini();
    } catch (erro) {
        return res.status(500).json({ sucesso: false, mensagem: erro.message });
    }

    prepararRespostaStream(res);

    try {

        const ai = new GoogleGenAI({ apiKey });

        const nomeArquivo = req.file.originalname.toLowerCase();
        const ehWord = nomeArquivo.endsWith('.docx');
        const ehPdf = nomeArquivo.endsWith('.pdf');

        if (!ehWord && !ehPdf) {
            enviarEvento(res, 'erro', { mensagem: 'Formato não suportado. Envie um arquivo .pdf ou .docx.' });
            return res.end();
        }

        let params;

        if (ehWord) {

            // Word: convertemos para texto simples primeiro (o Gemini não lê .docx diretamente)
            enviarEvento(res, 'status', { mensagem: 'Lendo o arquivo Word...' });

            const resultado = await mammoth.extractRawText({ buffer: req.file.buffer });
            const textoDocumento = resultado.value;

            const prompt = `Aqui está o conteúdo de um documento com uma lista de produtos:\n\n${textoDocumento}\n\n${montarInstrucoesFormato()}`;

            enviarEvento(res, 'prompt', { texto: prompt });

            params = { contents: prompt };

        } else {

            // PDF: o Gemini lê o arquivo diretamente, sem precisarmos converter nada
            enviarEvento(res, 'status', { mensagem: 'Lendo o arquivo PDF...' });

            const base64Pdf = req.file.buffer.toString('base64');

            const textoInstrucoes = `Aqui está um documento com uma lista de produtos.\n\n${montarInstrucoesFormato()}`;

            enviarEvento(res, 'prompt', { texto: `[Arquivo PDF anexado em base64, omitido aqui por ser muito grande]\n\n${textoInstrucoes}` });

            params = {
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
                            { text: textoInstrucoes }
                        ]
                    }
                ]
            };

        }

        const textoResposta = await chamarGeminiComStreamETentativas(ai, params, res);

        const produtos = processarRespostaIA(textoResposta);

        enviarEvento(res, 'final', { sucesso: true, produtos });
        res.end();

    } catch (erro) {

        console.error('Erro ao extrair produtos (arquivo):', erro);

        const eCotaEsgotada = erro.status === 429 || (erro.message && erro.message.includes('RESOURCE_EXHAUSTED'));

        enviarEvento(res, 'erro', {
            mensagem: eCotaEsgotada
                ? 'A cota diária gratuita de todos os modelos disponíveis foi esgotada, ou seu saldo pago acabou.'
                : 'Erro ao processar o arquivo com a IA. Tente novamente em alguns minutos.'
        });

        res.end();

    }

});

// ======================================
// FORMA 3 — EXTRAIR PRODUTOS DE UM TEXTO COLADO
// ======================================
router.post('/extrair-texto', async (req, res) => {

    const { texto } = req.body;

    if (!texto || texto.trim() === '') {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Cole o texto com os produtos.'
        });
    }

    let apiKey;

    try {
        apiKey = obterChaveGemini();
    } catch (erro) {
        return res.status(500).json({ sucesso: false, mensagem: erro.message });
    }

    prepararRespostaStream(res);

    try {

        const ai = new GoogleGenAI({ apiKey });

        const prompt = `Aqui está um texto copiado de uma página de produtos:\n\n${texto}\n\n${montarInstrucoesFormato()}`;

        enviarEvento(res, 'prompt', { texto: prompt });

        const textoResposta = await chamarGeminiComStreamETentativas(ai, {
            contents: prompt
        }, res);

        const produtos = processarRespostaIA(textoResposta);

        enviarEvento(res, 'final', { sucesso: true, produtos });
        res.end();

    } catch (erro) {

        console.error('Erro ao extrair produtos (texto):', erro);

        const eCotaEsgotada = erro.status === 429 || (erro.message && erro.message.includes('RESOURCE_EXHAUSTED'));

        enviarEvento(res, 'erro', {
            mensagem: eCotaEsgotada
                ? 'A cota diária gratuita de todos os modelos disponíveis foi esgotada, ou seu saldo pago acabou.'
                : 'Erro ao processar o texto com a IA. Tente novamente em alguns minutos.'
        });

        res.end();

    }

});

module.exports = router;