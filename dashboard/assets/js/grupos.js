/* =====================================================================
   grupos.js — tela GRUPOS (versão provisória)
   ---------------------------------------------------------------------
   Hoje o sistema só tem UM grupo, e as configurações dele (nicho,
   horário, produtos por hora) vêm de /api/dashboard.
   Quando o back-end criar /api/grupos, esta tela vai listar todos.
   ===================================================================== */

async function carregarGrupoAtual() {

    const cartao = document.getElementById("cartaoGrupoAtual");

    try {

        const [respostaDash, respostaStatus, respostaProdutos] = await Promise.all([
            fetch("/api/dashboard"),
            fetch("/api/config/status"),
            fetch("/api/produtos")
        ]);

        const dados = await respostaDash.json();
        const status = await respostaStatus.json();
        const produtos = await respostaProdutos.json();

        const ativas = produtos.filter(p => p.ativo).length;

        cartao.innerHTML = `
            <div class="topoGrupo">
                <span class="quadradoIcone ok">${icone("grupos")}</span>
                <span style="flex:1;">
                    <strong>I Ama Promos</strong>
                    <small>${escaparHtml(dados.nicho || "Sem nicho definido")}</small>
                </span>
                <span class="etiqueta ${status.sistemaAtivo ? "ok" : "aviso"}">${status.sistemaAtivo ? "Postando" : "Pausado"}</span>
            </div>
            <div class="dadosGrupo">
                <div><span>Horário</span><strong>${dados.horarioInicio}h às ${dados.horarioFim}h</strong></div>
                <div><span>Por hora</span><strong>${dados.produtosPorHora} ofertas</strong></div>
                <div><span>Ofertas ativas</span><strong>${ativas}</strong></div>
                <div><span>Categorias</span><strong>Todas</strong></div>
            </div>
            <a href="/configuracoes" class="botao largo">${icone("ajustes")} Ajustar horário e quantidade</a>
        `;

    } catch (erro) {

        console.error("Erro ao carregar grupo:", erro);
        cartao.innerHTML = `<p class="subtitulo">Não foi possível carregar os dados do grupo.</p>`;

    }

}

carregarGrupoAtual();
