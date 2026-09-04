const puppeteer = require('puppeteer');
const { calcularSimilaridadeTitulos, precosSaoProximos } = require('./produtos');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ======================================
// Mantém UM navegador aberto e reaproveitado entre resoluções (só é aberto
// na primeira vez que for realmente necessário), em vez de abrir e fechar
// um processo do Chromium inteiro a cada produto — mais leve pro servidor.
// ======================================
let promessaDoNavegador = null;

function obterNavegador() {

    if (!promessaDoNavegador) {
        promessaDoNavegador = puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }

    return promessaDoNavegador;

}

// ======================================
// Fila simples: garante que só UMA resolução roda por vez (Mercado Livre ou
// Amazon, tanto faz), mesmo que várias sejam disparadas quase juntas (ex:
// importação de vários produtos de uma vez). Evita sobrecarregar o servidor
// com várias abas ao mesmo tempo.
// ======================================
let filaAtual = Promise.resolve();

function enfileirar(tarefa) {

    const proxima = filaAtual.then(tarefa, tarefa);

    // Nunca deixa um erro de uma tarefa quebrar a fila pras próximas
    filaAtual = proxima.catch(() => {});

    return proxima;

}

// ======================================
// Verifica de qual marketplace é um link de afiliado (ou se é de nenhum dos
// que sabemos resolver automaticamente, por enquanto).
// ======================================
function ehLinkMercadoLivre(link) {
    return typeof link === 'string' && link.includes('meli.la');
}

function ehLinkAmazon(link) {
    return typeof link === 'string' && link.includes('link.amazon');
}

function ehLinkConhecido(link) {
    return ehLinkMercadoLivre(link) || ehLinkAmazon(link);
}

// ======================================
// MERCADO LIVRE: abre o link de afiliado num navegador de verdade
// (headless), segue os redirecionamentos automáticos até a página "de
// perfil" do Mercado Livre, e dentro dela encontra o link do produto real.
//
// Três estratégias, em ordem de preferência:
//
// 1) O link marcado como "card-featured" — mais rápida, mas nem sempre
//    está presente (a página muda de layout com frequência).
//
// 2) Clicar de verdade no botão "Ir para produto" (a mesma ação que você
//    faria manualmente). Como é um navegador automatizado, o Mercado Livre
//    às vezes insere um portão extra de verificação de conta no meio do
//    caminho — mas esse portão já vem com o link de destino real escondido
//    dentro dele (no parâmetro "go="), então extraímos ele de lá, sem
//    precisar "passar" pelo portão de verdade.
//
// 3) Reserva final: compara o TÍTULO real do produto com os links de
//    produto disponíveis na página, e escolhe o que tem mais palavras em
//    comum — só aceita se pelo menos 2 palavras baterem, pra não arriscar
//    "chutar" um produto errado por coincidência.
//
// A imagem (og:image) é capturada logo no início, antes de qualquer clique
// que possa navegar pra outra página — ela já se mostrou confiável em
// todos os testes até agora.
// ======================================
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

            console.log(`🔬 [diagnóstico ML] "${linkAfiliado}" -> chegou em: ${pagina.url()}`);

            // Captura a imagem e tenta a estratégia 1 (card-featured) logo de cara
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

            // Estratégia 2: clicar de verdade no botão "Ir para produto"
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

                        console.log(`🔬 [diagnóstico ML] depois do clique em "Ir para produto", chegou em: ${urlDepoisDoClique}`);

                    } catch (erroClique) {

                        console.log(`🔬 [diagnóstico ML] não conseguiu clicar em "Ir para produto": ${erroClique.message}`);

                    }

                }

            }

            // Estratégia 3: comparação por título (só roda se as duas anteriores falharam)
            if (!linkOriginal && tituloEsperado) {

                linkOriginal = await pagina.evaluate((tituloEsperado) => {

                    function normalizar(texto) {
                        return (texto || '')
                            .toString()
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '')
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

            const resultado = { linkOriginal, imagem, estrategiaUsada };

            console.log(`🔬 [diagnóstico ML] resultado:`, JSON.stringify(resultado));

            return resultado;

        } catch (erro) {

            console.log(`🔬 [diagnóstico ML] ERRO em "${linkAfiliado}": ${erro.message}`);
            throw erro;

        } finally {

            await pagina.close();

        }

    });

}

// ======================================
// AMAZON: em duas etapas.
//
// 1) Usa o navegador de verdade só pra seguir o redirecionamento do link
//    de afiliado até a página real do produto. Usa "domcontentloaded" (não
//    "networkidle2") porque a Amazon nunca "sossega" de verdade a rede —
//    ela fica com pedidos de segundo plano acontecendo sempre, o que fazia
//    a gente esperar até estourar o tempo à toa. domcontentloaded já é
//    suficiente pra pegar o endereço final depois do redirecionamento.
//
// 2) Com esse endereço limpo em mãos, faz um pedido simples (sem precisar
//    de navegador) direto nele — isso NÃO cai no bloqueio de "Continuar
//    comprando" que aparece na navegação normal, e o conteúdo real da
//    página vem completo. De lá, procura a foto principal do produto nos
//    dados estruturados que a própria Amazon guarda na página
//    (data-a-dynamic-image, um mapa de "foto -> tamanho"), escolhendo a
//    maior versão disponível. Se por algum motivo esses dados não
//    estiverem lá, tenta como reserva o padrão de nome de arquivo mais
//    comum da foto grande oficial.
// ======================================
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

            console.log(`🔬 [diagnóstico Amazon] "${linkAfiliado}" -> chegou em: ${linkOriginal}`);

        } catch (erro) {

            console.log(`🔬 [diagnóstico Amazon] ERRO ao resolver o link "${linkAfiliado}": ${erro.message}`);
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

                console.log(`🔬 [diagnóstico Amazon] status do fetch da página final: ${resposta.status}`);

                const html = await resposta.text();

                console.log(`🔬 [diagnóstico Amazon] tamanho da página: ${html.length} caracteres`);

                // Estratégia 1 (preferida): os dados estruturados que a
                // Amazon guarda na página, com todas as versões de tamanho
                // da foto principal — pega a maior disponível.
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

                        console.log(`🔬 [diagnóstico Amazon] data-a-dynamic-image encontrado mas não deu pra interpretar: ${erroJson.message}`);

                    }

                }

                // Estratégia 2 (reserva): padrão de nome de arquivo da foto
                // grande oficial, usado se a estratégia 1 não funcionar.
                if (!imagem) {

                    const correspondencia = html.match(
                        /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_]+\._AC_SL1500_\.jpg/i
                    );

                    imagem = correspondencia ? correspondencia[0] : null;

                }

                console.log(`🔬 [diagnóstico Amazon] imagem encontrada: ${imagem || 'NÃO ENCONTRADA'}`);

            } catch (erro) {

                console.log(`🔬 [diagnóstico Amazon] ERRO ao buscar a imagem em "${linkOriginal}": ${erro.message}`);

                // Se essa parte falhar, não tem problema — pelo menos o
                // link original já foi resolvido com sucesso.

            }

        }

        return { linkOriginal, imagem };

    });

}

// ======================================
// Escolhe automaticamente o resolvedor certo, de acordo com o marketplace
// do link recebido. O título esperado só é usado pelo Mercado Livre (ajuda
// a identificar o produto certo quando o marcador principal não existe).
// ======================================
async function resolverLinkAfiliado(linkAfiliado, tituloEsperado) {

    if (ehLinkMercadoLivre(linkAfiliado)) {
        return resolverLinkMercadoLivre(linkAfiliado, tituloEsperado);
    }

    if (ehLinkAmazon(linkAfiliado)) {
        return resolverLinkAmazon(linkAfiliado);
    }

    throw new Error('Marketplace não suportado para resolução automática.');

}

// ==========================================================================
// NOVO: busca automática de produto no Mercado Livre por título + preço
// ==========================================================================
//
// Objetivo: dado um produto que a IA já extraiu (título, preço, preço
// antigo), achar sozinho o link real do produto no Mercado Livre — sem
// depender da API de busca (que hoje está retornando 403 pra muita gente,
// mesmo autenticada) e sem você precisar garimpar manualmente.
//
// Como funciona:
//  1) Abre a página pública de busca do ML com o título do produto
//     (mesmo navegador/fila do resto do resolvedor).
//  2) Extrai candidatos da página renderizada (título, preço, preço antigo,
//     link, imagem) — usando o padrão de URL de produto (/MLB-\d+/ ou
//     /p/MLB\d+/) em vez de nomes de classe CSS, porque o Mercado Livre
//     muda os nomes de classe com frequência mas o padrão de URL do
//     produto é estável.
//  3) Compara cada candidato com o produto da IA usando as MESMAS funções
//     de similaridade de título e proximidade de preço que o sistema já
//     usa pra detectar duplicata (calcularSimilaridadeTitulos,
//     precosSaoProximos) — reaproveitando lógica já validada, em vez de
//     inventar um critério novo do zero.
//  4) Decide:
//     - Se o melhor candidato bate os dois critérios (similaridade >= 0.6
//       E preço a até 15% de diferença): match CONFIANTE, preenche sozinho.
//     - Senão: devolve os 3 melhores candidatos por similaridade, pra você
//       escolher manualmente (muito mais rápido que garimpar a busca
//       inteira).
//     - Se a busca não achar nenhum candidato: relata "não encontrado".
// ==========================================================================

const SIMILARIDADE_MINIMA_MATCH_CONFIANTE = 0.6;

// ======================================
// Abre a página de busca pública do ML e extrai os candidatos visíveis.
// Retorna um array (pode vir vazio se a busca não achar nada, ou se a
// extração falhar por mudança de layout — nesse caso NUNCA lança erro pra
// não quebrar a importação inteira, só loga o diagnóstico e devolve []).
// ======================================
async function buscarProdutosMercadoLivre(termoBusca) {

    return enfileirar(async () => {

        const navegador = await obterNavegador();
        const pagina = await navegador.newPage();

        try {

            await pagina.setUserAgent(USER_AGENT);

            const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termoBusca)}`;

            await pagina.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 20000
            });

            console.log(`🔬 [diagnóstico busca ML] "${termoBusca}" -> chegou em: ${pagina.url()}`);

            // O mesmo portão de verificação de conta que o resolverLinkMercadoLivre
            // já contorna ao resolver link de afiliado também aparece aqui, ao abrir
            // a busca direto. Em vez de tentar "passar" por ele, extraímos o destino
            // real escondido no parâmetro "go=" e navegamos direto pra lá — sem isso,
            // a extração de candidatos sempre roda em cima da página do portão (que
            // não tem nenhum produto) e retorna 0 candidatos.
            if (pagina.url().includes('account-verification')) {

                const urlObj = new URL(pagina.url());
                const destino = urlObj.searchParams.get('go');

                if (destino) {

                    console.log(`🔬 [diagnóstico busca ML] caiu no portão de verificação, indo direto pro destino real: ${destino}`);

                    await pagina.goto(destino, {
                        waitUntil: 'networkidle2',
                        timeout: 20000
                    });

                    console.log(`🔬 [diagnóstico busca ML] depois do redirecionamento, chegou em: ${pagina.url()}`);

                }

            }

            const candidatos = await pagina.evaluate(() => {

                // Produto real no ML sempre tem um ID no padrão MLB seguido
                // de dígitos, seja como "/MLB-1234567890-titulo" ou
                // "/p/MLB12345678" (produto de catálogo). Esse padrão é bem
                // mais estável do que nomes de classe CSS, que o Mercado
                // Livre reformula com frequência.
                const padraoProduto = /MLB-?\d{8,}/;

                const ancoras = Array.from(document.querySelectorAll('a[href]'))
                    .filter(a => padraoProduto.test(a.href));

                // Evita processar a mesma "carta" de produto duas vezes,
                // caso tenha mais de um link apontando pra ela (ex: link na
                // foto E link no título).
                const containersJaVistos = new Set();
                const resultado = [];

                ancoras.forEach(a => {

                    // Sobe até achar um container razoável da "carta" do
                    // produto (onde título, preço e imagem moram juntos).
                    let container = a.closest('li') || a.closest('article') || a.parentElement;

                    if (!container || containersJaVistos.has(container)) return;
                    containersJaVistos.add(container);

                    // Título: o alt da imagem principal costuma ser o nome
                    // completo e "limpo" do produto, mais confiável do que
                    // tentar montar o título a partir de texto solto.
                    const imagemEl = container.querySelector('img');
                    const titulo = (imagemEl && (imagemEl.alt || '')).trim() || (a.innerText || '').trim();

                    if (!titulo) return;

                    // Preço: pega todos os trechos "R$ 1.234,56" no texto do
                    // container. O preço RISCADO (antigo) normalmente fica
                    // dentro de uma tag <s>; o preço atual é o que sobra.
                    function extrairNumero(texto) {
                        const limpo = texto.replace(/[^\d,]/g, '').replace(',', '.');
                        const numero = parseFloat(limpo);
                        return isNaN(numero) ? null : numero;
                    }

                    const elementoPrecoAntigo = container.querySelector('s');
                    const precoAntigo = elementoPrecoAntigo
                        ? extrairNumero(elementoPrecoAntigo.innerText || '')
                        : null;

                    // Remove qualquer menção de parcelamento ("12x R$ 20,82"
                    // etc.) ANTES de procurar preços — senão o valor da
                    // parcela (sempre o menor "R$" do texto) seria
                    // confundido com o preço à vista real.
                    const textoContainer = (container.innerText || '')
                        .replace(/\d+\s*x\s*R\$\s?[\d.,]+/gi, '');

                    const todosOsPrecos = Array.from(
                        textoContainer.matchAll(/R\$\s?[\d.,]+/g)
                    ).map(m => extrairNumero(m[0])).filter(n => n !== null);

                    // O preço atual é o menor valor de "R$" encontrado que
                    // NÃO seja o preço antigo riscado (quando existe um
                    // desconto, o valor à vista é sempre o menor).
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

            console.log(`🔬 [diagnóstico busca ML] "${termoBusca}" -> ${candidatos.length} candidato(s) extraído(s)`);

            return candidatos;

        } catch (erro) {

            console.log(`🔬 [diagnóstico busca ML] ERRO ao buscar "${termoBusca}": ${erro.message}`);
            return [];

        } finally {

            await pagina.close();

        }

    });

}

// ======================================
// Pontua e decide: recebe o produto que a IA extraiu + a lista de
// candidatos reais da busca, e devolve um resultado com um destes status:
//
//  - "confiante"     -> achou um candidato claro, já preenche sozinho
//  - "ambiguo"        -> devolve até 3 melhores candidatos pra escolha manual
//  - "nao_encontrado" -> a busca não trouxe nenhum candidato utilizável
//
// Extraída como função separada (sem Puppeteer) só pra poder ser testada
// isoladamente, sem precisar de navegador de verdade.
// ======================================
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

// ======================================
// Função de conveniência que junta busca + decisão — é essa que as rotas
// vão chamar. Nunca lança erro (mesma filosofia do resto do resolvedor):
// se algo falhar na busca, cai em "nao_encontrado" e a importação segue
// normalmente, sem travar o restante dos produtos.
// ======================================
async function encontrarProdutoMercadoLivre(produtoIA) {

    try {

        const candidatos = await buscarProdutosMercadoLivre(produtoIA.titulo);
        return decidirMelhorCandidato(produtoIA, candidatos);

    } catch (erro) {

        console.log(`🔬 [diagnóstico busca ML] ERRO inesperado ao processar "${produtoIA.titulo}": ${erro.message}`);
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