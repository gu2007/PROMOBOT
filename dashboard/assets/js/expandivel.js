// ======================================
// Faz uma caixinha de texto (textarea) crescer sozinha conforme o conteúdo,
// em vez de rolar por dentro de uma caixa pequena e fixa.
// ======================================
function ajustarAlturaTextarea(campo) {

    campo.style.height = "auto";
    campo.style.height = campo.scrollHeight + "px";

}

// ======================================
// Ativa esse comportamento em todo campo com a classe "campoExpandivel"
// dentro de um escopo (documento inteiro por padrão, ou um container
// específico — útil pra campos criados dinamicamente depois, como os
// resultados da Importação por IA).
//
// Pode ser chamada várias vezes sem problema: o listener só é ligado uma
// vez por campo (controlado pelo atributo data-expandivel-pronto), mas o
// ajuste de altura sempre roda de novo — útil depois de carregar um valor
// programaticamente (ex: abrir Editar Produto) ou limpar um campo.
// ======================================
function inicializarCamposExpandiveis(escopo) {

    const raiz = escopo || document;

    raiz.querySelectorAll("textarea.campoExpandivel").forEach(campo => {

        if (!campo.dataset.expandivelPronto) {
            campo.dataset.expandivelPronto = "1";
            campo.addEventListener("input", () => ajustarAlturaTextarea(campo));
        }

        ajustarAlturaTextarea(campo);

    });

}

document.addEventListener("DOMContentLoaded", () => inicializarCamposExpandiveis());