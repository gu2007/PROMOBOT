document.getElementById('formLogin').addEventListener('submit', async (e) => {

    e.preventDefault();

    const usuario = document.getElementById('usuario').value;
    const senha = document.getElementById('senha').value;
    const erroEl = document.getElementById('erroLogin');

    erroEl.textContent = '';

    try {

        const resposta = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha })
        });

        const dados = await resposta.json();

        if (dados.sucesso) {
            window.location.href = '/';
        } else {
            erroEl.textContent = dados.mensagem || 'Usuário ou senha inválidos.';
        }

    } catch (erro) {
        erroEl.textContent = 'Erro ao conectar com o servidor.';
    }

});