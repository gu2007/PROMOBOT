const puppeteer = require('puppeteer');
const { calcularSimilaridadeTitulos, precosSaoProximos } = require('./produtos');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Mantém um navegador aberto e reaproveitado entre resoluções, em vez de
// abrir e fechar o Chromium inteiro a cada produto.
let promessaDoNavegador = null;

function obterNavegador() {

    if (!promessaDoNavegador) {
        promessaDoNavegador = puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
    }

    return promessaDoNavegador;

}

// Garante que só uma resolução roda por vez, mesmo que várias sejam
// disparadas quase juntas (ex: importação de vários produtos de uma vez).
let filaAtual = Promise.resolve();

function enfileirar(tarefa) {

    const proxima = filaAtual.then(tarefa, tarefa);
    filaAtual = proxima.catch(() => {});

    return proxima;

}

function ehLinkMercadoLivre(link) {
    return typeof link === 'string' && link.includes('meli.la');
}

function ehLinkAmazon(link) {
    return typeof link === 'string' && link.includes('link.amazon');
}

function ehLinkConhecido(link) {
    return ehLinkMercadoLivre(link) || ehLinkAmazon(link);
}

// Abre o link de afiliado do Mercado Livre num navegador real e segue os
// redirecionamentos até achar o link do produto de verdade. Três
// estratégias, em ordem de preferência: o link "card-featured" quando
// presente; clicar em "Ir para produto" (o Mercado Livre às vezes insere
// um portão de verificação de conta no meio do caminho, mas o destino real
// já vem escondido no parâmetro "go=" desse portão, então extraímos ele de
// lá em vez de tentar passar pelo portão); e, por último, comparar o
// título do produto com os links disponíveis na página.
async function resolverLinkMercadoLivre(linkAfiliado, tituloEsperado) {

    return enfileirar(async () => {

        const navegador = await obterNavegador();
        const pagina = await navegador.newPage();

        try {

            await pagina.setUserAgent(USER_AGENT);

            await pagina.goto(linkAfiliado, {
                waitUntil: 'networkidle2',
                timeout: 20000
            });

            console.log(`[ML] "${linkAfiliado}" -> chegou em: ${pagina.url()}`);

            const primeiraTentativa = await pagina.evaluate(() => {

                const links = Array.from(document.querySelectorAll('a[href]'));

                const destacado = links.find(
                    a => a.href.includes('card-featured') && a.href.includes('/p/')
                );

                const tagImagem = document.querySelector('meta[property="og:image"]');

                return {
                    linkOriginal: destacado ? destacado.href.split('?')[0] : null,
                    imagem: tagImagem ? tagImagem.content : null
                };

            });

            let linkOriginal = primeiraTentativa.linkOriginal;
            const imagem = primeiraTentativa.imagem;
            let estrategiaUsada = linkOriginal ? 'card-featured' : null;

            if (!linkOriginal) {

                const urlAntesDoClique = pagina.url();

                const marcado = await pagina.evaluate(() => {
                    const elementos = Array.from(document.querySelectorAll('a, button'));
                    const alvo = elementos.find(el => (el.innerText || '').trim().toLowerCase().includes('ir para produto'));
                    if (alvo) {
                        alvo.setAttribute('data-resolvedor-alvo', '1');
                        return true;
                    }
                    return false;
                });

                if (marcado) {

                    try {

                        await Promise.all([
                            pagina.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
                            pagina.click('[data-resolvedor-alvo="1"]')
                        ]);

                        const urlDepoisDoClique = pagina.url();

                        if (urlDepoisDoClique.includes('account-verification')) {

                            const urlObj = new URL(urlDepoisDoClique);
                            const destinoCodificado = urlObj.searchParams.get('go');

                            if (destinoCodificado) {
                                linkOriginal = destinoCodificado.split('?')[0];
                                estrategiaUsada = 'clique (via portao de verificacao)';
                            }

                        } else if (urlDepoisDoClique !== urlAntesDoClique) {

                            linkOriginal = urlDepoisDoClique.split('?')[0];
                            estrategiaUsada = 'clique (direto)';

                        }

                    } catch (erroClique) {

                        console.log(`[ML] não conseguiu clicar em "Ir para produto": ${erroClique.message}`);

                    }

                }

            }

            // Última tentativa: compara o título esperado com os links de
            // produto da página, só aceita se pelo menos 2 palavras baterem.
            if (!linkOriginal && tituloEsperado) {

                linkOriginal = await pagina.evaluate((tituloEsperado) => {

                    function normalizar(texto) {
                        return (texto || '')
                            .toString()
                            .normalize('NFD')
                            .replace(/[̀-ͯ]/g, '')
                            .toLowerCase()
                            .replace(/[^a-z0-9\s-]/g, ' ')
                            .replace(/[\s-]+/g, ' ')
                            .trim();
                    }

                    const links = Array.from(document.querySelectorAll('a[href]'));
                    const candidatos = links.filter(a => /\/p\/MLB\d+/.test(a.href));

                    const palavrasEsperadas = new Set(
                        normalizar(tituloEsperado).split(' ').filter(p => p.length >= 3)
                    );

                    let melhorPontuacao = 0;
                    let melhorCandidato = null;

                    candidatos.forEach(a => {

                        const palavrasCandidato = new Set(
                            normalizar(a.href).split(' ').filter(p => p.length >= 3)
                        );

                        let emComum = 0;
                        palavrasEsperadas.forEach(p => {
                            if (palavrasCandidato.has(p)) emComum++;
                        });

                        if (emComum > melhorPontuacao) {
                            melhorPontuacao = emComum;
                            melhorCandidato = a;
                        }

                    });

                    return melhorPontuacao >= 2 ? melhorCandidato.href.split('?')[0] : null;

                }, tituloEsperado);

                if (linkOriginal) {
                    estrategiaUsada = 'comparacao-titulo';
                }

            }

            return { linkOriginal, imagem, estrategiaUsada };

        } catch (erro) {

            console.log(`[ML] erro em "${linkAfiliado}": ${erro.message}`);
            throw erro;

        } finally {

            await pagina.close();

        }

    });

}

// Amazon: primeiro segue o redirecionamento do link de afiliado num
// navegador real até a página do produto (domcontentloaded, porque a
// Amazon nunca "sossega" a rede de verdade). Depois busca essa URL direto
// com fetch, que não cai no bloqueio de "Continuar comprando" que aparece
// na navegação normal, e extrai a imagem principal dos dados estruturados
// que a Amazon guarda na página (data-a-dynamic-image).
async function resolverLinkAmazon(linkAfiliado) {

    return enfileirar(async () => {

        const navegador = await obterNavegador();
        const pagina = await navegador.newPage();

        let linkOriginal = null;

        try {

            await pagina.setUserAgent(USER_AGENT);

            await pagina.goto(linkAfiliado, {
                waitUntil: 'domcontentloaded',
                timeout: 20000
            });

            linkOriginal = pagina.url().split('?')[0];

            console.log(`[Amazon] "${linkAfiliado}" -> chegou em: ${linkOriginal}`);

        } catch (erro) {

            console.log(`[Amazon] erro ao resolver o link "${linkAfiliado}": ${erro.message}`);
            throw erro;

        } finally {

            await pagina.close();

        }

        let imagem = null;

        if (linkOriginal) {

            try {

                const resposta = await fetch(linkOriginal, {
                    headers: { 'User-Agent': USER_AGENT }
                });

                const html = await resposta.text();

                const matchDynamic = html.match(/data-a-dynamic-image="([^"]+)"/);

                if (matchDynamic) {

                    try {

                        const jsonTexto = matchDynamic[1]
                            .replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&');

                        const mapaImagens = JSON.parse(jsonTexto);

                        let maiorArea = 0;

                        Object.entries(mapaImagens).forEach(([url, dimensoes]) => {
                            const area = (dimensoes[0] || 0) * (dimensoes[1] || 0);
                            if (area > maiorArea) {
                                maiorArea = area;
                                imagem = url;
                            }
                        });

                    } catch (erroJson) {

                        console.log(`[Amazon] data-a-dynamic-image não deu pra interpretar: ${erroJson.message}`);

                    }

                }

                // Reserva: padrão de nome de arquivo da foto grande oficial.
                if (!imagem) {

                    const correspondencia = html.match(
                        /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_]+\._AC_SL1500_\.jpg/i
                    );

                    imagem = correspondencia ? correspondencia[0] : null;

                }

            } catch (erro) {

                console.log(`[Amazon] erro ao buscar a imagem em "${linkOriginal}": ${erro.message}`);

            }

        }

        return { linkOriginal, imagem };

    });

}

async function resolverLinkAfiliado(linkAfiliado, tituloEsperado) {

    if (ehLinkMercadoLivre(linkAfiliado)) {
        return resolverLinkMercadoLivre(linkAfiliado, tituloEsperado);
    }

    if (ehLinkAmazon(linkAfiliado)) {
        return resolverLinkAmazon(linkAfiliado);
    }

    throw new Error('Marketplace não suportado para resolução automática.');

}

// Busca automática de produto no Mercado Livre por título + preço, sem
// depender da API de busca (que retorna 403 mesmo autenticada) e sem
// garimpar manualmente. Abre a busca pública, extrai candidatos da página
// e compara com o produto que a IA já extraiu (título + preço) usando as
// mesmas funções de similaridade que o sistema já usa pra detectar
// duplicata. Se o melhor candidato bater os dois critérios, preenche
// sozinho; senão devolve até 3 candidatos pra escolha manual.
const SIMILARIDADE_MINIMA_MATCH_CONFIANTE = 0.6;

async function buscarProdutosMercadoLivre(termoBusca) {

    return enfileirar(async () => {

        const navegador = await obterNavegador();
        const pagina = await navegador.newPage();

        try {

            await pagina.setUserAgent(USER_AGENT);

            // O Mercado Livre manda essa busca pro portão de verificação de
            // conta com bastante frequência; as linhas abaixo tentam
            // disfarçar os sinais mais óbvios de automação.
            await pagina.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });
            await pagina.setViewport({ width: 1366, height: 768 });
            await pagina.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

            const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termoBusca)}`;

            await pagina.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 20000
            });

            // O mesmo portão de verificação de conta aparece aqui também.
            // Em vez de tentar passar por ele, extraímos o destino real do
            // parâmetro "go=" e navegamos direto pra lá.
            if (pagina.url().includes('account-verification')) {

                const urlObj = new URL(pagina.url());
                const destino = urlObj.searchParams.get('go');

                if (destino) {

                    await pagina.goto(destino, {
                        waitUntil: 'networkidle2',
                        timeout: 20000
                    });

                }

            }

            const candidatos = await pagina.evaluate(() => {

                // Produto real do ML sempre tem um ID no padrão MLB seguido
                // de dígitos — mais estável que nomes de classe CSS, que o
                // Mercado Livre reformula com frequência.
                const padraoProduto = /MLB-?\d{8,}/;

                const ancoras = Array.from(document.querySelectorAll('a[href]'))
                    .filter(a => padraoProduto.test(a.href));

                const containersJaVistos = new Set();
                const resultado = [];

                ancoras.forEach(a => {

                    let container = a.closest('li') || a.closest('article') || a.parentElement;

                    if (!container || containersJaVistos.has(container)) return;
                    containersJaVistos.add(container);

                    // O alt da imagem principal costuma ser o título completo
                    // e mais confiável do que montar a partir de texto solto.
                    const imagemEl = container.querySelector('img');
                    const titulo = (imagemEl && (imagemEl.alt || '')).trim() || (a.innerText || '').trim();

                    if (!titulo) return;

                    function extrairNumero(texto) {
                        const limpo = texto.replace(/[^\d,]/g, '').replace(',', '.');
                        const numero = parseFloat(limpo);
                        return isNaN(numero) ? null : numero;
                    }

                    const elementoPrecoAntigo = container.querySelector('s');
                    const precoAntigo = elementoPrecoAntigo
                        ? extrairNumero(elementoPrecoAntigo.innerText || '')
                        : null;

                    // Remove menções de parcelamento antes de procurar preços,
                    // senão o valor da parcela seria confundido com o preço à vista.
                    const textoContainer = (container.innerText || '')
                        .replace(/\d+\s*x\s*R\$\s?[\d.,]+/gi, '');

                    const todosOsPrecos = Array.from(
                        textoContainer.matchAll(/R\$\s?[\d.,]+/g)
                    ).map(m => extrairNumero(m[0])).filter(n => n !== null);

                    let preco = null;
                    if (todosOsPrecos.length > 0) {
                        const semAntigo = precoAntigo
                            ? todosOsPrecos.filter(p => p !== precoAntigo)
                            : todosOsPrecos;
                        preco = semAntigo.length > 0 ? Math.min(...semAntigo) : todosOsPrecos[0];
                    }

                    const link = a.href.split('?')[0];
                    const imagem = imagemEl ? (imagemEl.src || imagemEl.getAttribute('data-src') || null) : null;

                    resultado.push({ titulo, preco, precoAntigo, link, imagem });

                });

                return resultado;

            });

            return candidatos;

        } catch (erro) {

            console.log(`[busca ML] erro ao buscar "${termoBusca}": ${erro.message}`);
            return [];

        } finally {

            await pagina.close();

        }

    });

}

function decidirMelhorCandidato(produtoIA, candidatos) {

    const candidatosValidos = candidatos.filter(c => c.titulo && typeof c.preco === 'number');

    if (candidatosValidos.length === 0) {
        return { status: 'nao_encontrado' };
    }

    const pontuados = candidatosValidos.map(c => ({
        ...c,
        similaridade: calcularSimilaridadeTitulos(produtoIA.titulo, c.titulo)
    }));

    pontuados.sort((a, b) => b.similaridade - a.similaridade);

    const melhor = pontuados[0];

    const precoBate = precosSaoProximos(produtoIA.preco, melhor.preco);

    if (melhor.similaridade >= SIMILARIDADE_MINIMA_MATCH_CONFIANTE && precoBate) {
        return {
            status: 'confiante',
            linkOriginal: melhor.link,
            imagem: melhor.imagem,
            similaridade: melhor.similaridade
        };
    }

    return {
        status: 'ambiguo',
        candidatos: pontuados.slice(0, 3).map(c => ({
            titulo: c.titulo,
            preco: c.preco,
            precoAntigo: c.precoAntigo,
            link: c.link,
            imagem: c.imagem,
            similaridade: c.similaridade
        }))
    };

}

// Função de conveniência que junta busca + decisão, chamada pelas rotas.
// Nunca lança erro: se algo falhar na busca, cai em "nao_encontrado" e a
// importação segue normalmente para os demais produtos.
async function encontrarProdutoMercadoLivre(produtoIA) {

    try {

        const candidatos = await buscarProdutosMercadoLivre(produtoIA.titulo);
        return decidirMelhorCandidato(produtoIA, candidatos);

    } catch (erro) {

        console.log(`[busca ML] erro inesperado ao processar "${produtoIA.titulo}": ${erro.message}`);
        return { status: 'nao_encontrado' };

    }

}

module.exports = {
    ehLinkMercadoLivre,
    ehLinkAmazon,
    ehLinkConhecido,
    resolverLinkMercadoLivre,
    resolverLinkAmazon,
    resolverLinkAfiliado,
    buscarProdutosMercadoLivre,
    decidirMelhorCandidato,
    encontrarProdutoMercadoLivre
};
