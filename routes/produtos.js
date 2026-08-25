const express = require("express");
const router = express.Router();
const {
    listarProdutos,
    buscarProduto,
    salvarProdutos,
    adicionarProduto
} = require("../produtos");
const { ehLinkConhecido, resolverLinkAfiliado } = require("../resolvedorAfiliado");

// ======================================
// Dispara em segundo plano (sem atrasar a resposta pro navegador) a
// resolução automática do link original + imagem, quando o produto é de um
// marketplace conhecido (Mercado Livre ou Amazon) e ainda está faltando
// algum desses dois campos.
// ======================================
function dispararResolucaoSeNecessario(produto) {

    if (!produto || !ehLinkConhecido(produto.linkAfiliado)) {
        return;
    }

    if (produto.linkOriginal && produto.imagem) {
        return;
    }

    resolverLinkAfiliado(produto.linkAfiliado)
        .then(resultado => {

            const produtos = listarProdutos();
            const indice = produtos.findIndex(p => p.id === produto.id);

            // O produto pode ter sido excluído ou editado enquanto a resolução rodava
            if (indice === -1) {
                return;
            }

            let mudouAlgumaCoisa = false;

            if (resultado.linkOriginal && !produtos[indice].linkOriginal) {
                produtos[indice].linkOriginal = resultado.linkOriginal;
                mudouAlgumaCoisa = true;
            }

            if (resultado.imagem && !produtos[indice].imagem) {
                produtos[indice].imagem = resultado.imagem;
                mudouAlgumaCoisa = true;
            }

            if (mudouAlgumaCoisa) {

                produtos[indice].atualizadoEm = new Date().toISOString();
                salvarProdutos(produtos);

                console.log(`✅ Link original / imagem resolvidos automaticamente para o produto #${produto.id} (${produto.titulo.slice(0, 40)}).`);

            }

        })
        .catch(erro => {

            console.log(`⚠️ Não foi possível resolver automaticamente o produto #${produto.id}: ${erro.message}`);

        });

}

// ======================================
// LISTAR TODOS OS PRODUTOS
// ======================================
router.get("/", (req, res) => {
    res.json(listarProdutos());
});

// ======================================
// RESOLVER EM MASSA: roda a resolução automática (link original + imagem)
// em todos os produtos do Mercado Livre e Amazon que ainda estão com algum
// desses campos vazio — útil pra completar produtos antigos, cadastrados
// antes dessa funcionalidade existir. Mostra o progresso em tempo real
// (SSE), produto por produto, igual à Verificação de Preços.
// ======================================
router.post("/resolver-pendentes", async (req, res) => {

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    function enviarEvento(tipo, dados) {
        res.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
    }

    const todosOsProdutos = listarProdutos();

    const pendentes = todosOsProdutos.filter(produto =>
        ehLinkConhecido(produto.linkAfiliado) && (!produto.linkOriginal || !produto.imagem)
    );

    enviarEvento("inicio", { total: pendentes.length });

    let resolvidos = 0;
    let falhas = 0;

    for (const produto of pendentes) {

        try {

            const resultado = await resolverLinkAfiliado(produto.linkAfiliado);

            const produtosAtuais = listarProdutos();
            const indice = produtosAtuais.findIndex(p => p.id === produto.id);

            let mudouAlgumaCoisa = false;

            if (indice !== -1) {

                if (resultado.linkOriginal && !produtosAtuais[indice].linkOriginal) {
                    produtosAtuais[indice].linkOriginal = resultado.linkOriginal;
                    mudouAlgumaCoisa = true;
                }

                if (resultado.imagem && !produtosAtuais[indice].imagem) {
                    produtosAtuais[indice].imagem = resultado.imagem;
                    mudouAlgumaCoisa = true;
                }

                if (mudouAlgumaCoisa) {
                    produtosAtuais[indice].atualizadoEm = new Date().toISOString();
                    salvarProdutos(produtosAtuais);
                }

            }

            if (mudouAlgumaCoisa) {
                resolvidos++;
            } else {
                falhas++;
            }

            enviarEvento("produto", {
                produtoId: produto.id,
                titulo: produto.titulo,
                sucesso: mudouAlgumaCoisa
            });

        } catch (erro) {

            falhas++;

            enviarEvento("produto", {
                produtoId: produto.id,
                titulo: produto.titulo,
                sucesso: false,
                erro: erro.message
            });

        }

    }

    enviarEvento("final", { total: pendentes.length, resolvidos, falhas });

    res.end();

});

// ======================================
// BUSCAR UM PRODUTO
// ======================================
router.get("/:id", (req, res) => {
    const produto = buscarProduto(req.params.id);
    if (!produto) {
        return res.status(404).json({
            sucesso: false,
            mensagem: "Produto não encontrado."
        });
    }
    res.json(produto);
});

// ======================================
// CADASTRAR PRODUTO
// ======================================
router.post("/", (req, res) => {
    try {

        const produtoSalvo = adicionarProduto(req.body);

        res.json({
            sucesso: true,
            mensagem: "Produto cadastrado com sucesso."
        });

        dispararResolucaoSeNecessario(produtoSalvo);

    } catch (erro) {
        console.error(erro);
        res.status(500).json({
            sucesso: false,
            mensagem: "Erro ao cadastrar produto."
        });
    }
});

// ======================================
// EDITAR PRODUTO
// ======================================
router.put("/:id", (req, res) => {
    const produtos = listarProdutos();
    const indice = produtos.findIndex(
        produto => produto.id === Number(req.params.id)
    );
    if (indice === -1) {
        return res.status(404).json({
            sucesso: false,
            mensagem: "Produto não encontrado."
        });
    }
    produtos[indice] = {
        ...produtos[indice],
        ...req.body,
        id: produtos[indice].id,
        enviado: produtos[indice].enviado,
        criadoEm: produtos[indice].criadoEm,
        atualizadoEm: new Date().toISOString()
    };
    salvarProdutos(produtos);
    res.json({
        sucesso: true,
        mensagem: "Produto atualizado."
    });

    dispararResolucaoSeNecessario(produtos[indice]);

});

// ======================================
// ATIVAR / DESATIVAR
// ======================================
router.patch("/:id", (req, res) => {
    const produtos = listarProdutos();
    const indice = produtos.findIndex(
        produto => produto.id === Number(req.params.id)
    );
    if (indice === -1) {
        return res.status(404).json({
            sucesso: false,
            mensagem: "Produto não encontrado."
        });
    }
    produtos[indice].ativo = !produtos[indice].ativo;
    produtos[indice].atualizadoEm = new Date().toISOString();
    salvarProdutos(produtos);
    res.json({
        sucesso: true,
        ativo: produtos[indice].ativo
    });
});

// ======================================
// EXCLUIR PRODUTO
// ======================================
router.delete("/:id", (req, res) => {
    const produtos = listarProdutos();
    const indice = produtos.findIndex(
        produto => produto.id === Number(req.params.id)
    );
    if (indice === -1) {
        return res.status(404).json({
            sucesso: false,
            mensagem: "Produto não encontrado."
        });
    }
    produtos.splice(indice, 1);
    salvarProdutos(produtos);
    res.json({
        sucesso: true,
        mensagem: "Produto excluído com sucesso."
    });
});

module.exports = router;