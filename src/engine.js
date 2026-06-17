const RADICAIS_FORTES = ['benefic', 'credor', 'exequ', 'autor', 'favorec', 'titular', 'herde', 'sucess', 'pag', 'receb', 'levant', 'deposit', 'transfer', 'requis', 'principal', 'liquid', 'apur', 'devid', 'homolog', 'total', 'saldo'];
const RADICAIS_MEDIOS = ['demonstr', 'rpv', 'decis', 'sentenc', 'despach'];
const RADICAIS_NEGATIVOS = ['honor', 'advog', 'oab', 'juiz', 'desembarg', 'relator', 'servid', 'procurad', 'cust', 'despes', 'juros', 'correc', 'percent', 'inss', 'irrf', 'impost'];

const CLASS_BENEFICIARIO = ['benefic', 'credor', 'exequ', 'herde', 'sucess'];
const CLASS_REPRESENTANTE = ['advog', 'oab', 'procurad'];
const CLASS_AUTORIDADE = ['juiz', 'desembarg', 'relator'];
const VALUE_ANCHOR_BOOSTS = [
  ['saldo a ser rateado', 220],
  ['credito total', 180],
  ['valor total', 150],
  ['valor homologado', 140],
  ['saldo homologado', 140],
  ['valor devido', 120],
  ['rateio', 90],
  ['rateado', 90],
  ['quinhao', 70],
  ['partilha', 60],
  ['montante', 40],
];

const VALUE_RE = /R\$\s*(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{2})?/g;
const CPF_RE = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
const CNPJ_RE = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
const DATA_RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const PROC_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

const NOME_RE = /(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)(?:\s+(?:da|de|do|das|dos|e)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]?[a-záéíóúâêôãõç]*|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){1,5}/g;
const EMPRESA_RE = /\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇ.&'-]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇ.&'-]+)*\s+(?:LTDA|S\/A|S\.A\.|EIRELI|EPP|ME))\b/;
const GOV_RE = /\b((?:Munic[ií]pio|Estado|Uni[aã]o|Fazenda|Prefeitura|Secretaria|Autarquia|Funda[cç][aã]o|Instituto)(?:\s+(?:de|do|da|dos|das))?\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇ ]*)/;

const STOPWORDS_ENT = new Set(['Precatorio', 'Calculo', 'Demonstrativo', 'Requisicao', 'Pagamento', 'Valor', 'Total', 'Saldo', 'Honorarios', 'Juros', 'Tribunal', 'Justica', 'Vara', 'Oficio', 'Processo', 'Beneficiario', 'Beneficiaria', 'Credor', 'Credora', 'Exequente', 'Autor', 'Pagina', 'Data', 'Real', 'Reais', 'Determino', 'Despacho', 'Sentenca', 'Decisao']);

export const FASES = [
  ['buscarValores', 'Buscar valores'],
  ['aplicarMinimo', 'Aplicar valor mínimo'],
  ['criarRegioes', 'Criar regiões'],
  ['fundirRegioes', 'Fundir regiões'],
  ['pontuar', 'Pontuar regiões'],
  ['detectarSecoes', 'Detectar seções locais'],
  ['extrairEntidades', 'Extrair entidades'],
  ['classificarEntidades', 'Classificar entidades'],
  ['associar', 'Associar entidades e valores'],
  ['consolidar', 'Consolidar resultados'],
];

export const PRESETS = {
  rapido: ['buscarValores', 'aplicarMinimo', 'criarRegioes', 'fundirRegioes', 'pontuar'],
  balanceado: FASES.map((fase) => fase[0]),
  completo: FASES.map((fase) => fase[0]),
  experimental: null,
};

export const STREAM_STEPS = [
  ['recorte', 'Recorte do documento'],
  ['valores', 'Busca de valores'],
  ['minimo', 'Aplicação do valor mínimo'],
  ['regioes', 'Construção de regiões'],
  ['fusao', 'Fusão de regiões'],
  ['pontuacao', 'Pontuação por radicais'],
  ['entidades', 'Extração de entidades'],
  ['associacao', 'Associação valor e beneficiário'],
  ['consolidacao', 'Consolidação de resultados'],
];

export const EXEMPLO = `TRIBUNAL DE JUSTICA DO ESTADO DE SAO PAULO
OFICIO REQUISITORIO DE PRECATORIO
Processo 0012345-67.2019.8.26.0053
Data 12/03/2024


BENEFICIARIA
Maria Aparecida da Silva
CPF 123.456.789-00
Credora principal na presente acao judicial.
Valor do precatorio atualizado e homologado: R$ 248.530,12
Honorarios advocaticios Dr. Joao Pereira OAB 123456: R$ 24.853,01
Juros de mora aplicados sobre o principal: R$ 5.120,00
Custas processuais recolhidas: R$ 1.230,00




BENEFICIARIO
Jose Carlos de Oliveira
Exequente sucessor do credor original na demanda.
Valor total do precatorio devido: R$ 87.940,55
Honorarios sucumbenciais: R$ 8.794,05
INSS retido na fonte: R$ 3.200,00




CONSTRUTORA HORIZONTE LTDA
Credora em acao de cobranca contra a Fazenda.
Valor requisitado apurado e homologado: R$ 1.503.200,00
Calculo elaborado pela contadoria judicial.




Despacho do Juiz de Direito Dr. Antonio Ferreira
Determino o pagamento conforme calculo homologado.
Custas finais R$ 500,00.`;

function stripAccentsLower(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function applyTextBoosts(text, boosts, factor = 1) {
  let bonus = 0;
  const factors = [];
  boosts.forEach(([term, weight]) => {
    if (!text.includes(term)) return;
    const contrib = Math.round(weight * factor);
    bonus += contrib;
    factors.push({ radical: term, tipo: 'ancora', peso: weight, dist: 0, fator: factor, hits: 1, contrib });
  });
  return { bonus, factors };
}

function isJunkContext(line, matchIndex, matchText) {
  const around = line.slice(Math.max(0, matchIndex - 4), matchIndex + matchText.length + 4);
  if (CPF_RE.test(around)) return true;
  if (CNPJ_RE.test(around)) return true;
  if (PROC_RE.test(around)) return true;
  if (DATA_RE.test(around)) return true;
  const after = line.slice(matchIndex + matchText.length, matchIndex + matchText.length + 2);
  if (/^\s*%/.test(after)) return true;
  return false;
}

function looksMonetary(matchText) {
  return /R\$/.test(matchText);
}

function normalizeValue(raw) {
  let value = raw.replace(/R\$/, '').trim();
  value = value.replace(/[.\s]/g, '');
  value = value.replace(',', '.');
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function fmtBRL(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function looksLikeName(text) {
  const words = text.trim().split(/\s+/).filter((word) => !/^(da|de|do|das|dos|e)$/i.test(word));
  if (words.length < 2) return false;
  const meaningful = words.filter((word) => !STOPWORDS_ENT.has(stripAccentsLower(word).replace(/^./, (char) => char.toUpperCase())));
  return meaningful.length >= 2;
}

function classifyByContext(lines, lineIdx) {
  const seg = [];
  for (let index = Math.max(0, lineIdx - 2); index <= Math.min(lines.length - 1, lineIdx + 2); index += 1) {
    seg.push(stripAccentsLower(lines[index].text));
  }
  const ctx = seg.join(' ');
  for (const radical of CLASS_REPRESENTANTE) {
    if (new RegExp(`\\b${radical}`).test(ctx)) return 'representante';
  }
  for (const radical of CLASS_AUTORIDADE) {
    if (new RegExp(`\\b${radical}`).test(ctx)) return 'autoridade';
  }
  for (const radical of CLASS_BENEFICIARIO) {
    if (new RegExp(`\\b${radical}`).test(ctx)) return 'beneficiario';
  }
  return 'indefinido';
}

function detectSections(regionLines) {
  const sections = [];
  regionLines.forEach((line) => {
    const text = line.text.trim();
    if (!text) return;
    const isUpper = text === text.toUpperCase() && /[A-ZÁÉÍÓÚ]/.test(text);
    const isShort = text.length <= 45;
    const hasColon = /:/.test(text);
    const isNumbered = /^\s*\d+[.)]/.test(text);
    let signal = 0;
    if (isUpper) signal += 2;
    if (isShort) signal += 1;
    if (hasColon) signal += 1;
    if (isNumbered) signal += 1;
    if (signal >= 2 && isShort) sections.push({ line: line.globalLine, text });
  });
  return sections;
}

export function runPipeline(pages, params, onPhase) {
  const startTime = Date.now();
  const phase = (name, extra) => {
    if (onPhase) onPhase(name, extra);
  };

  const totalPages = pages.length;
  let selected = pages;
  if (params.pageStart && params.pageEnd) {
    selected = pages.filter((page) => page.page >= params.pageStart && page.page <= params.pageEnd);
  } else if (params.percent && params.percent < 100) {
    const count = Math.max(1, Math.round((totalPages * params.percent) / 100));
    selected = pages.slice(Math.max(0, totalPages - count));
  }

  const lines = [];
  selected.forEach((page) => {
    page.text.split(/\r?\n/).forEach((raw) => {
      lines.push({ globalLine: lines.length, page: page.page, text: raw });
    });
  });
  phase('recorte', { totalPages, analyzed: selected.length, lines: lines.length });

  const valores = [];
  if (params.fases.buscarValores !== false) {
    lines.forEach((line) => {
      let match;
      VALUE_RE.lastIndex = 0;
      while ((match = VALUE_RE.exec(line.text)) !== null) {
        const raw = match[0].trim();
        if (raw.replace(/[^\d]/g, '').length === 0) continue;
        if (!looksMonetary(raw)) continue;
        if (isJunkContext(line.text, match.index, raw)) continue;
        const norm = normalizeValue(raw);
        if (norm === null || norm <= 0) continue;
        valores.push({
          raw,
          norm,
          page: line.page,
          line: line.globalLine,
          monetary: looksMonetary(raw),
          context: line.text.trim(),
        });
      }
    });
  }
  phase('valores', { count: valores.length });

  let validos = valores;
  if (params.fases.aplicarMinimo !== false) {
    validos = valores.filter((valor) => valor.norm >= (params.valorMinimo || 0));
  }
  phase('minimo', { count: validos.length, min: params.valorMinimo });

  const win = params.janela || 20;
  let regions = [];
  if (params.fases.criarRegioes !== false) {
    validos.forEach((valor, idx) => {
      const start = Math.max(0, valor.line - win);
      const end = Math.min(lines.length - 1, valor.line + win);
      regions.push({
        id: `R${idx + 1}`,
        startLine: start,
        endLine: end,
        anchorValue: valor,
        valores: [valor],
        page: valor.page,
      });
    });
  }
  phase('regioes', { count: regions.length });

  if (params.fases.fundirRegioes !== false && regions.length) {
    regions.sort((a, b) => a.startLine - b.startLine);
    const merged = [];
    let current = regions[0];
    for (let index = 1; index < regions.length; index += 1) {
      const region = regions[index];
      if (region.startLine <= current.endLine + 5) {
        current.endLine = Math.max(current.endLine, region.endLine);
        current.valores.push(...region.valores);
      } else {
        merged.push(current);
        current = region;
      }
    }
    merged.push(current);
    merged.forEach((region, idx) => {
      region.id = `R${idx + 1}`;
    });
    regions = merged;
  }
  phase('fusao', { count: regions.length });

  const allRadicais = [
    ...RADICAIS_FORTES.map((radical) => ({ radical, weight: 100, tipo: 'forte' })),
    ...RADICAIS_MEDIOS.map((radical) => ({ radical, weight: 50, tipo: 'medio' })),
    ...RADICAIS_NEGATIVOS.map((radical) => ({ radical, weight: -100, tipo: 'negativo' })),
  ];

  function distanceFactor(delta) {
    const distance = Math.abs(delta);
    if (distance === 0) return 1;
    if (distance <= 2) return 0.7;
    if (distance <= 5) return 0.4;
    return 0.2;
  }

  const multP = params.multPrecator || 1;
  const multC = params.multCalcul || 1;
  const detectSecoesOn = params.fases.detectarSecoes !== false;

  function scoreAnchor(anchorLine) {
    const start = Math.max(0, anchorLine - win);
    const end = Math.min(lines.length - 1, anchorLine + win);
    const windowLines = lines.slice(start, end + 1);
    const factors = [];
    let score = 0;
    const anchorText = stripAccentsLower(lines[anchorLine]?.text || '');
    const anchorBoost = applyTextBoosts(anchorText, VALUE_ANCHOR_BOOSTS, 1);
    score += anchorBoost.bonus;
    factors.push(...anchorBoost.factors);

    windowLines.forEach((line) => {
      const lineNorm = stripAccentsLower(line.text);
      const delta = line.globalLine - anchorLine;
      const factor = distanceFactor(delta);
      const localBoost = applyTextBoosts(lineNorm, VALUE_ANCHOR_BOOSTS, factor * 0.35);
      if (localBoost.bonus) {
        score += localBoost.bonus;
        factors.push(...localBoost.factors.map((item) => ({ ...item, dist: delta, fator: factor })));
      }
      allRadicais.forEach(({ radical, weight, tipo }) => {
        const regex = new RegExp(`\\b${radical}\\w*`, 'g');
        let hits = 0;
        while (regex.exec(lineNorm) !== null) {
          hits += 1;
          if (hits > 3) break;
        }
        if (hits > 0) {
          const contrib = weight * factor * hits;
          score += contrib;
          factors.push({ radical, tipo, peso: weight, dist: delta, fator: factor, hits, contrib });
        }
      });
      const precatorioRegex = /\bprecator\w*/g;
      let match;
      while ((match = precatorioRegex.exec(lineNorm)) !== null) {
        const contrib = 100 * multP * factor;
        score += contrib;
        factors.push({ radical: 'precator', tipo: 'precatorio', peso: 100 * multP, dist: delta, fator: factor, hits: 1, contrib });
      }
      const calculoRegex = /\bcalcul\w*/g;
      while ((match = calculoRegex.exec(lineNorm)) !== null) {
        const contrib = 100 * multC * factor;
        score += contrib;
        factors.push({ radical: 'calcul', tipo: 'calculo', peso: 100 * multC, dist: delta, fator: factor, hits: 1, contrib });
      }
    });
    const sections = detectSecoesOn ? detectSections(windowLines) : [];
    if (sections.length) score += 15 * sections.length;
    factors.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
    return { score: Math.round(score), factors, sections };
  }

  regions.forEach((region) => {
    region.valores.sort((a, b) => b.norm - a.norm);
    region.anchorValue = region.valores[0];
    region.score = scoreAnchor(region.anchorValue.line).score;
  });
  phase('pontuacao', {});

  let entidades = [];
  if (params.fases.extrairEntidades !== false) {
    lines.forEach((line) => {
      const text = line.text;
      let match;
      NOME_RE.lastIndex = 0;
      while ((match = NOME_RE.exec(text)) !== null) {
        const name = match[0].trim().replace(/\s+/g, ' ');
        if (!looksLikeName(name)) continue;
        entidades.push({ name, line: line.globalLine, page: line.page, kind: 'pessoa' });
      }
      const empresa = EMPRESA_RE.exec(text);
      if (empresa) entidades.push({ name: empresa[1].trim(), line: line.globalLine, page: line.page, kind: 'empresa' });
      const governo = GOV_RE.exec(text);
      if (governo) entidades.push({ name: governo[1].trim().replace(/\s+/g, ' '), line: line.globalLine, page: line.page, kind: 'governo' });
    });
    if (params.fases.classificarEntidades !== false) {
      entidades.forEach((entidade) => {
        entidade.tipo = entidade.kind === 'governo' || entidade.kind === 'empresa'
          ? 'beneficiario'
          : classifyByContext(lines, entidade.line);
      });
    } else {
      entidades.forEach((entidade) => {
        entidade.tipo = 'indefinido';
      });
    }
  }
  phase('entidades', { count: entidades.length });

  let hipoteses = [];
  let hid = 0;
  const assocWin = Math.min(win, 8);
  if (params.fases.associar !== false) {
    const benefCandidatos = entidades.filter((entidade) => entidade.tipo === 'beneficiario' || (entidade.tipo === 'indefinido' && entidade.kind === 'pessoa'));
    validos.forEach((valor) => {
      const scored = scoreAnchor(valor.line);
      let best = null;
      let bestCost = Number.POSITIVE_INFINITY;
      benefCandidatos.forEach((entidade) => {
        const delta = entidade.line - valor.line;
        if (Math.abs(delta) > assocWin) return;
        const rank = entidade.tipo === 'beneficiario' ? 0 : 1;
        const acima = delta <= 0 ? 0 : 1.5;
        const proximity = Math.max(0, assocWin - Math.abs(delta));
        const bonus = entidade.tipo === 'beneficiario' ? 25 : 10;
        const cost = rank * 100 + Math.abs(delta) + acima - Math.min(20, proximity + bonus);
        if (cost < bestCost) {
          best = entidade;
          bestCost = cost;
        }
      });
      hipoteses.push({
        id: `H${++hid}`,
        beneficiario: best ? best.name : (params.labelNaoEncontrado || 'Não identificado'),
        beneficiarioTipo: best ? best.tipo : null,
        valor: valor.norm,
        valorRaw: valor.raw,
        page: valor.page,
        line: valor.line,
        score: scored.score,
        factors: scored.factors,
        sections: scored.sections,
        contexto: valor.context,
        identificado: Boolean(best),
      });
    });
  }
  phase('associacao', {});

  if (params.fases.consolidar !== false) {
    const byBenef = new Map();
    hipoteses.forEach((hipotese) => {
      const key = stripAccentsLower(hipotese.beneficiario);
      if (!byBenef.has(key)) byBenef.set(key, []);
      byBenef.get(key).push(hipotese);
    });
    const consolidadas = [];
    byBenef.forEach((arr, key) => {
      if (key === stripAccentsLower(params.labelNaoEncontrado || 'Não identificado')) {
        const seen = new Set();
        arr.sort((a, b) => b.score - a.score).forEach((hipotese) => {
          const valueKey = Math.round(hipotese.valor);
          if (seen.has(valueKey)) return;
          seen.add(valueKey);
          consolidadas.push({ ...hipotese, secundarios: [] });
        });
        return;
      }
      arr.sort((a, b) => b.score - a.score);
      const principal = arr[0];
      principal.secundarios = arr.slice(1, 6).map((hipotese) => ({ raw: hipotese.valorRaw, norm: hipotese.valor, page: hipotese.page }));
      const extra = arr.slice(1).reduce((acc, hipotese) => acc + Math.round(hipotese.score * 0.15), 0);
      principal.score += extra;
      consolidadas.push(principal);
    });
    hipoteses = consolidadas;
  } else {
    hipoteses.forEach((hipotese) => {
      hipotese.secundarios = [];
    });
  }

  hipoteses = hipoteses.filter((hipotese) => hipotese.score > 0);
  hipoteses.sort((a, b) => b.score - a.score);

  const maxScore = hipoteses.length ? hipoteses[0].score : 1;
  hipoteses.forEach((hipotese) => {
    const probability = Math.max(5, Math.min(99, Math.round((hipotese.score / maxScore) * 92 + 7)));
    hipotese.probabilidade = probability;
  });

  const elapsed = (Date.now() - startTime) / 1000;
  const charCount = selected.reduce((acc, page) => acc + page.text.length, 0);
  const metrics = {
    tempo: elapsed,
    tokens: Math.round(charCount / 4),
    totalPages,
    analyzed: selected.length,
    valoresEncontrados: valores.length,
    valoresAcimaMin: validos.length,
    regioes: regions.length,
    entidades: entidades.length,
    hipoteses: hipoteses.length,
  };

  return { hipoteses, metrics };
}
