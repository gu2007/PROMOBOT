const puppeteer = require('puppeteer');

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

module.exports = {
    ehLinkMercadoLivre,
    ehLinkAmazon,
    ehLinkConhecido,
    resolverLinkMercadoLivre,
    resolverLinkAmazon,
    resolverLinkAfiliado
};