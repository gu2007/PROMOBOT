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
// perfil" do Mercado Livre, e dentro dela encontra o link do produto real
// (marcado como "card-featured" — testado e confirmado em produtos
// diferentes) e a URL da imagem oficial do produto (og:image).
// ======================================
async function resolverLinkMercadoLivre(linkAfiliado) {

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

            const resultado = await pagina.evaluate(() => {

                const links = Array.from(document.querySelectorAll('a[href]'));

                const destacado = links.find(
                    a => a.href.includes('card-featured') && a.href.includes('/p/')
                );

                const linkOriginal = destacado ? destacado.href.split('?')[0] : null;

                const tagImagem = document.querySelector('meta[property="og:image"]');
                const imagem = tagImagem ? tagImagem.content : null;

                return { linkOriginal, imagem };

            });

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
//    de afiliado até a página real do produto (a Amazon bloqueia o
//    conteúdo dessa navegação com uma tela de "Continuar comprando", mas o
//    ENDEREÇO final já é confiável mesmo assim — testado e confirmado).
//
// 2) Com esse endereço limpo em mãos, faz um pedido simples (sem precisar
//    de navegador) direto nele — testamos e essa segunda etapa NÃO cai no
//    mesmo bloqueio, e o conteúdo real da página vem completo. De lá,
//    procura a foto principal do produto (a Amazon salva ela com o
//    sufixo "_AC_SL1500_", o tamanho grande oficial).
// ======================================
async function resolverLinkAmazon(linkAfiliado) {

    return enfileirar(async () => {

        const navegador = await obterNavegador();
        const pagina = await navegador.newPage();

        let linkOriginal = null;

        try {

            await pagina.setUserAgent(USER_AGENT);

            await pagina.goto(linkAfiliado, {
                waitUntil: 'networkidle2',
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

                const correspondencia = html.match(
                    /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+\-_]+\._AC_SL1500_\.jpg/i
                );

                imagem = correspondencia ? correspondencia[0] : null;

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
// do link recebido.
// ======================================
async function resolverLinkAfiliado(linkAfiliado) {

    if (ehLinkMercadoLivre(linkAfiliado)) {
        return resolverLinkMercadoLivre(linkAfiliado);
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