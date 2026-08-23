const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const {
    listarProdutosAtivos,
    aplicarResultadoVerificacao,
    buscarProduto
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
// Adiciona um parâmetro único (baseado no horário atual) na URL, tentando
// "enganar" qualquer cache que a ferramenta de leitura de página use por
// endereço exato — fizemos testes e confirmamos que a mesma URL, consultada
// em dias diferentes, retornou o preço IDÊNTICO mesmo o preço real tendo
// mudado de verdade (forte indício de cache). Um parâmetro novo a cada
// chamada faz a URL parecer "nunca vista antes".
// ======================================
function montarUrlSemCache(url) {

    try {

        const urlObj = new URL(url);
        const marcador = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
        urlObj.searchParams.set('_verificacaoPromobot', marcador);
        return urlObj.toString();

    } catch (erro) {

        // Se a URL for inválida por algum motivo, usa ela do jeito que está
        return url;

    }

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

    const urlParaLeitura = montarUrlSemCache(produto.linkOriginal);

    const prompt = `Acesse esta página de produto: ${urlParaLeitura}

Leia o TÍTULO e o PREÇO ATUAL do produto diretamente na página, com muito cuidado pra não confundir:

- Use o preço À VISTA de venda do produto (o valor principal em destaque), NUNCA o valor de uma parcela (ex: se a página mostra "12x de R$ 50", isso NÃO é o preço — o preço é o valor total à vista).
- Se houver um preço riscado (preço antigo/de) e um preço em destaque (preço atual/por), use APENAS o preço em destaque atual, nunca o riscado.
- Se a página mostrar variações do produto (cores, tamanhos, modelos diferentes) com preços diferentes, use o preço da variação que já vem selecionada/em destaque por padrão na página, não de uma variação aleatória.
- Se você não tiver certeza absoluta de qual é o preço correto por causa de ambiguidade na página, prefira retornar "conseguiuAcessar": false a arriscar um valor errado.

Depois, verifique se existe alguma indicação EXPLÍCITA na própria página de que o produto não pode ser comprado agora — por exemplo textos como "produto esgotado", "anúncio pausado", "produto não encontrado" ou uma página de erro real. Se não houver nenhuma indicação assim, considere o produto disponível normalmente.

${precisaDeImagem ? 'Além disso, encontre a URL absoluta (começando com http:// ou https://) da imagem/foto principal do produto na página (a foto de capa do anúncio). Isso é usado só de forma informativa, não precisa ter certeza absoluta — se não encontrar uma URL de imagem clara, retorne null nesse campo.' : ''}

Retorne APENAS este JSON, sem nenhum texto antes ou depois, sem marcadores de código:

{
  "conseguiuAcessar": true ou false (true se você conseguiu ler um título e preço reais da página, com certeza de qual é o preço correto; false se a página não carregou, foi bloqueada, mostrou captcha/erro, OU se houve qualquer ambiguidade sobre qual é o preço certo),
  "disponivel": true ou false (false apenas se a página mostrar explicitamente que o produto está esgotado/pausado/removido),
  "preco": número (preço à vista atual, sem símbolo de moeda, sem ser valor de parcela) ou null,
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
        console.log(`🔬 [diagnóstico] urlContextMetadata para "${urlParaLeitura}":`, JSON.stringify(metadados));
    } catch (erroLog) {
        console.log('🔬 [diagnóstico] Não foi possível ler urlContextMetadata:', erroLog.message);
    }

    let texto = textoAcumulado.trim();
    texto = texto.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

    const resultado = JSON.parse(texto);

    console.log(`🔬 [diagnóstico] resultado completo da IA para produto "${produto.titulo.slice(0, 40)}":`, JSON.stringify(resultado));

    return resultado;

}

// ======================================
// Roda a verificação nos produtos ativos, um de cada vez, com uma pequena
// pausa entre eles pra não estourar limite de requisições.
//
// Parâmetros:
// - idsEspecificos: se informado, verifica só esses produtos.
// - onProgresso: função opcional chamada após CADA produto verificado, com
//   um evento descrevendo o que aconteceu. Usada pela rota manual (streaming
//   em tempo real pro navegador); o job automático semanal não passa essa
//   função, e o comportamento continua sendo só registrar nos logs.
// ======================================
async function rodarVerificacaoSemanal(idsEspecificos, onProgresso) {

    const resumo = {
        totalVerificados: 0,
        alteracoesEncontradas: 0,
        sugestoesPendentes: 0,
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
        if (onProgresso) onProgresso({ tipo: 'erro_geral', mensagem: erro.message });
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

    const mensagemInicio = `🔎 Verificação iniciada: ${produtosParaChecar.length} produto(s) para checar (${resumo.semLinkOriginal} pulado(s) por não ter link original cadastrado).`;
    console.log(mensagemInicio);

    if (onProgresso) {
        onProgresso({
            tipo: 'inicio',
            totalParaChecar: produtosParaChecar.length,
            semLinkOriginal: resumo.semLinkOriginal
        });
    }

    for (const produto of produtosParaChecar) {

        try {

            const resultado = await verificarProdutoUnico(ai, produto);

            resumo.totalVerificados++;

            if (resultado.conseguiuAcessar !== true) {

                resumo.naoConseguiuAcessar++;
                console.log(`ℹ️ Produto #${produto.id} não pôde ser confirmado (link bloqueado/inacessível), nada foi alterado: ${produto.titulo.slice(0, 50)}`);

                if (onProgresso) {
                    onProgresso({
                        tipo: 'produto',
                        produtoId: produto.id,
                        titulo: produto.titulo,
                        resultadoTipo: 'nao_confirmado'
                    });
                }

                continue;

            }

            const precoAntes = produto.preco;
            const jaTinhaImagemAntes = !!produto.imagem;

            aplicarResultadoVerificacao(produto.id, resultado);

            const produtoAtualizado = buscarProduto(produto.id);

            if (!jaTinhaImagemAntes && resultado.imagemUrl) {
                resumo.imagensCapturadas++;
                console.log(`🖼️ Produto #${produto.id} ganhou uma foto: ${produto.titulo.slice(0, 50)}`);
            }

            let resultadoTipo = 'sem_mudanca';

            if (resultado.disponivel === false) {

                resumo.alteracoesEncontradas++;
                resultadoTipo = 'indisponivel';
                resumo.detalhes.push(`#${produto.id} ficou indisponível: ${produto.titulo.slice(0, 50)}`);
                console.log(`⚠️ Produto #${produto.id} indisponível, desativado: ${produto.titulo.slice(0, 50)}`);

            } else if (produtoAtualizado.tipoAlteracao === 'preco_sugerido') {

                if (typeof resultado.preco === 'number') {
                    resumo.sugestoesPendentes++;
                    resultadoTipo = 'sugestao_pendente';
                    resumo.detalhes.push(`#${produto.id} diferença grande de preço (R$${precoAntes} -> R$${resultado.preco}), aguardando sua confirmação: ${produto.titulo.slice(0, 50)}`);
                    console.log(`🟡 Produto #${produto.id} diferença de preço grande demais pra aplicar sozinho, aguardando confirmação: R$${precoAntes} -> R$${resultado.preco}`);
                }

            } else if (typeof resultado.preco === 'number' && Math.abs(resultado.preco - precoAntes) / Math.max(resultado.preco, precoAntes) >= 0.10) {

                resumo.alteracoesEncontradas++;
                resultadoTipo = 'preco_atualizado';
                resumo.detalhes.push(`#${produto.id} preço mudou de R$${precoAntes} para R$${resultado.preco}: ${produto.titulo.slice(0, 50)}`);
                console.log(`💰 Produto #${produto.id} preço atualizado: R$${precoAntes} -> R$${resultado.preco}`);

            }

            if (onProgresso) {
                onProgresso({
                    tipo: 'produto',
                    produtoId: produto.id,
                    titulo: produto.titulo,
                    resultadoTipo,
                    precoAntes,
                    precoDepois: resultado.preco,
                    imagemCapturada: !jaTinhaImagemAntes && !!resultado.imagemUrl
                });
            }

        } catch (erro) {

            resumo.falhas++;
            console.error(`❌ Falha ao verificar produto #${produto.id}:`, erro.message);

            if (onProgresso) {
                onProgresso({
                    tipo: 'produto',
                    produtoId: produto.id,
                    titulo: produto.titulo,
                    resultadoTipo: 'falha',
                    mensagemErro: erro.message
                });
            }

        }

        // Pequena pausa entre cada chamada pra não estourar limite de requisições por minuto
        await new Promise(resolve => setTimeout(resolve, 4000));

    }

    console.log(`✅ Verificação concluída: ${resumo.totalVerificados} verificado(s), ${resumo.alteracoesEncontradas} alteração(ões), ${resumo.sugestoesPendentes} sugestão(ões) pendente(s), ${resumo.imagensCapturadas} imagem(ns) capturada(s), ${resumo.naoConseguiuAcessar} não confirmado(s), ${resumo.semLinkOriginal} sem link original, ${resumo.falhas} falha(s).`);

    if (onProgresso) {
        onProgresso({ tipo: 'final', resumo });
    }

    return resumo;

}

// ======================================
// Rota manual, pra testar a verificação sem esperar a semana passar.
// Aceita { produtoIds: [1, 2] } no corpo pra testar só em alguns produtos.
// Responde em streaming (SSE), mostrando o progresso produto por produto em
// tempo real — evita que a tela fique "travada" esperando minutos sem
// feedback (o que causava a conexão cair em verificações grandes).
// ======================================
router.post('/rodar-agora', async (req, res) => {

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    function enviarEvento(tipo, dados) {
        res.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
    }

    try {

        const idsEspecificos = req.body && Array.isArray(req.body.produtoIds) ? req.body.produtoIds : null;

        await rodarVerificacaoSemanal(idsEspecificos, (evento) => {
            enviarEvento('progresso', evento);
        });

        res.end();

    } catch (erro) {

        console.error('Erro ao rodar verificação manual:', erro);
        enviarEvento('erro', { mensagem: erro.message });
        res.end();

    }

});

module.exports = {
    router,
    rodarVerificacaoSemanal
};