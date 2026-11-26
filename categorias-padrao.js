// Categorias padrão do catálogo. Classifica pelo TÍTULO do produto (e, se o
// título não bastar, pela categoria antiga). A primeira regra que combinar vence,
// por isso a ordem importa (as mais específicas vêm antes).
const REGRAS = [
  ['Soldagem',                   /\b(solda|soldagem|soldador|macarico|maçarico|eletrodo|soprador t[eé]rmico|esta[nñ]o)\b/],
  ['Pneumática e Compressores',  /(pneum[aá]tic|compressor|finca[\s-]?pino|pistola (de|para) pintura|pistola pulverizadora|pulverizador|pistola de ar|calibrador de pneu)/],
  ['Lavadoras e Limpeza',        /(lavadora|lava[\s-]?jato|aspirador|alta press[aã]o|limpeza)/],
  ['Jardinagem',                 /(grama|ro[cç]adeira|soprador de folha|aparador|jardim|jardinagem|motosserra|podador)/],
  ['Segurança e EPI',            /(\bepi\b|luva(s)? (de|para) (seguran|prote)|[oó]culos de prote|protetor auricular|balaclava|m[aá]scara|respirador|prote[cç][aã]o individual|equipamento(s)? de prote)/],
  ['Automotivo e Moto',          /(macaco|automotiv|\bmoto\b|motocicleta|capacete|viseira|carenagem|funilaria|saca an[eé]is|lubrificante|capa de chuva|cavalete|chave de roda|polimento automotivo)/],
  ['Parafusadeiras e Furadeiras',/(parafusadeira|furadeira|martelete|chave de impacto|chave pneum)/],
  ['Esmerilhadeiras e Lixadeiras',/(esmerilhadeira|lixadeira|politriz|politrizes|ret[ií]fica|lixa orbital)/],
  ['Serras e Cortes',            /(serra|tup[ií]a|plaina|tico[\s-]?tico|cortador|guilhotina|estilete)/],
  ['Chaves e Soquetes',          /(soquete|catraca|torqu[ií]metro|chave (combinada|allen|torx|estrela|de fenda|phillips|inglesa|grifo|de boca|fixa|tubo)|chaves|\ballen\b|\btorx\b|phillips)/],
  ['Alicates e Ferramentas Manuais', /(alicate|martelo|marreta|for[mç][aã]o|talhadeira|grampeador|grampo|sargento|morsa|serrote|espatula|esp[aá]tula|raspador|pistola para silicone|misturador|\blima\b|ventosa|chave manual|ferramentas? manua)/],
  ['Medição e Eletrônica',       /(n[ií]vel|laser|trena|paqu[ií]metro|mult[ií]metro|medidor|medi[cç][aã]o|esquadro|term[oô]metro|detector|eletr[oô]nic|c[aâ]mera)/],
  ['Organização',                /(organizador|caixa|bolsa|mochila|painel|bancada|carrinho|arm[aá]rio|porta[\s-]?ferramentas|cinto|m[oó]vel|m[oó]veis|bandeja|prateleira|banqueta)/],
  ['Iluminação e Elétrica',      /(lanterna|ilumina|lumin[aá]ria|refletor|l[aâ]mpada|extens[aã]o|tomada|\bfio\b|conector|terminais)/],
  ['Máquinas e Equipamentos',    /(torno|bomba|paleteira|escada|betoneira|gerador|talha|guincho|empilhadeira|transpallet)/],
  ['Kits e Maletas',             /(\bkit\b|\bjogo\b|maleta|conjunto)/],
  ['Acessórios e Consumíveis',   /(broca|disco|lixa|abrasivo|bateria|carregador|acess[oó]rio|pe[cç]a|ponteira|bits?\b|fita|cola|adesivo|veda[cç][aã]o|rebite|parafuso)/],
];

const FALLBACK = 'Ferramentas';

function sem(texto) {
  return String(texto || '').toLowerCase();
}

function classificar(titulo, categoriaAntiga) {
  const t = sem(titulo);
  for (const [nome, re] of REGRAS) if (re.test(t)) return nome;
  const c = sem(categoriaAntiga);
  if (c && !/^coletor/.test(c)) {
    for (const [nome, re] of REGRAS) if (re.test(c)) return nome;
  }
  return FALLBACK;
}

const NOMES = [...REGRAS.map((r) => r[0]), FALLBACK];

module.exports = { classificar, NOMES, FALLBACK };
