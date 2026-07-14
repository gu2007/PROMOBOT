const express = require("express");
const router = express.Router();

const {
    totalProdutos,
    totalProdutosAtivos,
    totalCategorias
} = require("../produtos");

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

router.get("/", (req, res) => {

    const config = JSON.parse(
        fs.readFileSync(CONFIG_PATH, "utf8")
    );

    res.json({

        produtos: totalProdutos(),

        ativos: totalProdutosAtivos(),

        categorias: totalCategorias(),

        nicho: config.nicho,

        horarioInicio: config.horarioInicio,

        horarioFim: config.horarioFim,

        produtosPorHora: config.produtosPorHora,

        status: "Online"

    });

});

module.exports = router;