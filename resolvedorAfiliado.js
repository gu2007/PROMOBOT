const puppeteer = require('puppeteer');

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
// Fila simples: garante que só UMA resolução roda por vez, mesmo que várias
// sejam disparadas quase juntas (ex: importação de vários produtos de uma
// vez). Evita sobrecarregar o servidor com várias abas ao mesmo tempo.
// ======================================
let filaAtual = Promise.resolve();

function enfileirar(tarefa) {

    const proxima = filaAtual.then(tarefa, tarefa);

    // Nunca deixa um erro de uma tarefa quebrar a fila pras próximas
    filaAtual = proxima.catch(() => {});

    return proxima;

}

// ======================================
// Verifica se um link é um link de afiliado encurtado do Mercado Livre
// (os únicos que sabemos resolver automaticamente, por enquanto).
// ======================================
function ehLinkMercadoLivre(link) {

    return typeof link === 'string' && link.includes('meli.la');

}

// ======================================
// Abre o link de afiliado num navegador de verdade (headless), segue os
// redirecionamentos automáticos até a página "de perfil" do Mercado Livre,
// e dentro dela encontra o link do produto real (marcado como
// "card-featured" — testado e confirmado em produtos diferentes) e a URL
// da imagem oficial do produto (og:image).
// ======================================
async function resolverLinkMercadoLivre(linkAfiliado) {

    return enfileirar(async () => {

        const navegador = await obterNavegador();
        const pagina = await navegador.newPage();

        try {

            await pagina.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            await pagina.goto(linkAfiliado, {
                waitUntil: 'networkidle2',
                timeout: 20000
            });

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

            return resultado;

        } finally {

            await pagina.close();

        }

    });

}

module.exports = {
    ehLinkMercadoLivre,
    resolverLinkMercadoLivre
};