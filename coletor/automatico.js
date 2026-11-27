// ======= MODO AUTOMÁTICO (roda no seu PC) =======
// Liga tudo sozinho, durante o horário de funcionamento:
//   1) abre o Chrome do robô (se não estiver aberto)
//   2) coleta produtos novos  (coletor.js)  -> o servidor cadastra em até 5 min
//   3) revisa preços/disponibilidade (revisor.js) -> o servidor corrige em até 5 min
//   4) descansa e repete
// Fora do horário ele espera. Para parar: feche a janela ou aperte Ctrl+C.
// Se aparecer captcha/login, ele apita e espera você (como sempre).
//
//   node coletor\automatico.js
//   (ajustes opcionais:  --coleta=60  --revisao=40)
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? Number(a.split('=')[1]) || padrao : padrao;
};

const CFG = {
  janelaInicio: process.env.AUTO_JANELA_INI !== undefined ? Number(process.env.AUTO_JANELA_INI) : 8,
  janelaFim: process.env.AUTO_JANELA_FIM !== undefined ? Number(process.env.AUTO_JANELA_FIM) : 22,
  produtosColeta: arg('coleta', 60),
  produtosRevisao: arg('revisao', 40),
  descansoMin: process.env.AUTO_DESCANSO_MIN ? [Number(process.env.AUTO_DESCANSO_MIN), Number(process.env.AUTO_DESCANSO_MIN)] : [45, 75],
  limiteProcessoMin: 120,
  ciclosMax: Number(process.env.AUTO_CICLOS) || Infinity, // só para teste
  scriptColetor: process.env.AUTO_COLETOR || path.join(__dirname, 'coletor.js'),
  scriptRevisor: process.env.AUTO_REVISOR || path.join(__dirname, 'revisor.js'),
  semChrome: process.env.AUTO_SEM_CHROME === '1',
};

const PASTA_PERFIL = path.join(RAIZ, 'coletor', 'perfil-chrome-real');
const CAMINHOS_CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const aleatorio = (a, b) => a + Math.random() * (b - a);
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a);

function chromeAberto() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:9222/json/version', { timeout: 3000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function garantirChrome() {
  if (CFG.semChrome || (await chromeAberto())) return true;
  const exe = CAMINHOS_CHROME.find((c) => c && fs.existsSync(c));
  if (!exe) { log('❌ Não achei o chrome.exe. Abra o Chrome do robô à mão (comando Start-Process) e eu continuo.'); return false; }
  log('🌐 Abrindo o Chrome do robô...');
  const filho = spawn(exe, ['--remote-debugging-port=9222', `--user-data-dir=${PASTA_PERFIL}`], { detached: true, stdio: 'ignore' });
  filho.unref();
  for (let i = 0; i < 20; i++) { await esperar(1000); if (await chromeAberto()) { log('✅ Chrome do robô aberto.'); return true; } }
  log('❌ O Chrome não respondeu na porta 9222.');
  return false;
}

function rodar(nome, script, args) {
  return new Promise((resolve) => {
    log(`▶️ ${nome}...`);
    const filho = spawn(process.execPath, [script, ...args], { cwd: RAIZ, stdio: 'inherit' });
    const limite = setTimeout(() => { log(`⏱️ ${nome} passou de ${CFG.limiteProcessoMin} min: encerrando.`); filho.kill(); }, CFG.limiteProcessoMin * 60 * 1000);
    filho.on('exit', (codigo) => { clearTimeout(limite); log(`⏹️ ${nome} terminou (código ${codigo}).`); resolve(codigo); });
    filho.on('error', (e) => { clearTimeout(limite); log(`❌ ${nome} não iniciou: ${e.message}`); resolve(1); });
  });
}

const dentroDaJanela = () => { const h = new Date().getHours(); return h >= CFG.janelaInicio && h < CFG.janelaFim; };

(async () => {
  log(`🤖 Modo automático ligado. Janela: ${CFG.janelaInicio}h–${CFG.janelaFim}h | coleta ${CFG.produtosColeta} | revisão ${CFG.produtosRevisao}`);
  let ciclos = 0;
  let avisouFora = false;
  while (ciclos < CFG.ciclosMax) {
    if (!dentroDaJanela()) {
      if (!avisouFora) { log('💤 Fora do horário. Aguardando a janela abrir (confiro a cada 10 min).'); avisouFora = true; }
      await esperar(10 * 60 * 1000);
      continue;
    }
    avisouFora = false;

    if (await garantirChrome()) {
      await rodar('Coleta', CFG.scriptColetor, [`--n=${CFG.produtosColeta}`]);
      if (dentroDaJanela()) await rodar('Revisão', CFG.scriptRevisor, [`--n=${CFG.produtosRevisao}`]);
    } else {
      log('⏳ Sem Chrome nesta rodada. Tento de novo no próximo ciclo.');
    }

    ciclos++;
    if (ciclos >= CFG.ciclosMax) break;
    const min = aleatorio(...CFG.descansoMin);
    log(`⏳ Descansando ${Math.round(min)} min antes da próxima rodada.`);
    await esperar(min * 60 * 1000);
  }
  log('🏁 Modo automático encerrado.');
})();
