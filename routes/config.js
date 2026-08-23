const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const CONFIG_PATH = path.join(__dirname, "..", "config.json");
function carregarConfig() {
    return JSON.parse(
        fs.readFileSync(CONFIG_PATH, "utf8")
    );
}
function salvarConfig(config) {
    fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify(config, null, 2),
        "utf8"
    );
}
// ======================================
// RETORNA TODAS AS CONFIGURAÇÕES
// ======================================
router.get("/", (req, res) => {
    try {
        res.json(carregarConfig());
    } catch (erro) {
        res.status(500).json({
            erro: "Erro ao carregar configurações."
        });
    }
});
// ======================================
// SALVA AS CONFIGURAÇÕES
// ======================================
router.post("/", (req, res) => {
    try {
        const configAtual = carregarConfig();
      const novoConfig = {
            ...configAtual,
            nicho: req.body.nicho,
            horarioInicio: Number(req.body.horarioInicio),
            horarioFim: Number(req.body.horarioFim),
            produtosPorHora: Number(req.body.produtosPorHora),
            intervaloRepeticaoHoras: Number(req.body.intervaloRepeticaoHoras)
        };
        salvarConfig(novoConfig);
        res.json({
            sucesso: true,
            mensagem: "Configurações salvas com sucesso."
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({
            sucesso: false,
            mensagem: "Erro ao salvar configurações."
        });
    }
});
// ======================================
// STATUS DO SISTEMA
// ======================================
router.get("/status", (req, res) => {
    try {
        const config = carregarConfig();
        res.json({
            sistemaAtivo: config.sistemaAtivo ?? true
        });
    } catch (erro) {
        res.status(500).json({
            sucesso: false
        });
    }
});
// ======================================
// LIGA / DESLIGA O SISTEMA
// ======================================
router.patch("/status", (req, res) => {
    try {
        const config = carregarConfig();
        config.sistemaAtivo = req.body.sistemaAtivo;
        salvarConfig(config);
        res.json({
            sucesso: true,
            sistemaAtivo: config.sistemaAtivo
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({
            sucesso: false
        });
    }
});
module.exports = router;