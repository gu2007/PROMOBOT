function inicializarMenu() {

    const sidebar = document.getElementById("sidebar");
    const botaoMenu = document.getElementById("botaoMenu");
    const overlayMenu = document.getElementById("overlayMenu");

    if (!sidebar || !botaoMenu || !overlayMenu) {
        return;
    }

    function abrirMenu() {
        sidebar.classList.add("aberta");
        overlayMenu.classList.add("ativo");
        botaoMenu.textContent = "✕";
    }

    function fecharMenu() {
        sidebar.classList.remove("aberta");
        overlayMenu.classList.remove("ativo");
        botaoMenu.textContent = "☰";
    }

    botaoMenu.addEventListener("click", () => {
        if (sidebar.classList.contains("aberta")) {
            fecharMenu();
        } else {
            abrirMenu();
        }
    });

    overlayMenu.addEventListener("click", fecharMenu);

}

document.addEventListener("DOMContentLoaded", inicializarMenu);