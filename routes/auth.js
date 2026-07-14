const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const USUARIOS_PATH = path.join(__dirname, '..', 'usuario.json');

function carregarUsuarios() {
    if (!fs.existsSync(USUARIOS_PATH)) return [];
    return JSON.parse(fs.readFileSync(USUARIOS_PATH, 'utf8'));
}

function salvarUsuarios(usuarios) {
    fs.writeFileSync(USUARIOS_PATH, JSON.stringify(usuarios, null, 2), 'utf8');
}

// ======================================
// LOGIN
// ======================================
router.post('/login', (req, res) => {

    const { usuario, senha } = req.body;

    const usuarios = carregarUsuarios();

    const encontrado = usuarios.find(
        u => u.usuario === usuario && u.senha === senha && u.ativo
    );

    if (!encontrado) {
        return res.status(401).json({
            sucesso: false,
            mensagem: 'Usuário ou senha inválidos.'
        });
    }

    req.session.autenticado = true;
    req.session.usuario = encontrado.usuario;

    res.json({ sucesso: true });

});

// ======================================
// LOGOUT
// ======================================
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ sucesso: true });
    });
});

// ======================================
// VERIFICAR SESSÃO ATUAL
// ======================================
router.get('/sessao', (req, res) => {
    res.json({
        autenticado: !!(req.session && req.session.autenticado),
        usuario: req.session ? req.session.usuario : null
    });
});

// ======================================
// CADASTRAR NOVO USUÁRIO (só quem já está logado)
// ======================================
router.post('/usuarios', (req, res) => {

    if (!req.session || !req.session.autenticado) {
        return res.status(401).json({
            sucesso: false,
            mensagem: 'Você precisa estar logado para cadastrar usuários.'
        });
    }

    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Usuário e senha são obrigatórios.'
        });
    }

    const usuarios = carregarUsuarios();

    const jaExiste = usuarios.find(u => u.usuario === usuario);

    if (jaExiste) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Já existe um usuário com esse nome.'
        });
    }

    const novoUsuario = {
        id: usuarios.length > 0 ? Math.max(...usuarios.map(u => u.id)) + 1 : 1,
        usuario,
        senha,
        ativo: true
    };

    usuarios.push(novoUsuario);

    salvarUsuarios(usuarios);

    res.json({
        sucesso: true,
        mensagem: 'Usuário cadastrado com sucesso.'
    });

});

module.exports = router;