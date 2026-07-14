const agendamentos = [];

function adicionar(timeout) {
    agendamentos.push(timeout);
}

function limpar() {
    while (agendamentos.length > 0) {
        clearTimeout(agendamentos.pop());
    }
}

function quantidade() {
    return agendamentos.length;
}

module.exports = {
    adicionar,
    limpar,
    quantidade
};