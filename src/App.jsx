import { useEffect, useRef, useState } from 'react';
import { STREAM_STEPS, fmtBRL } from './engine.js';

const DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1ZCQ-nf8gva6R8lqAC6P_K6RYblh5s0wv';
const DRIVE_API_BASE_URL = 'http://127.0.0.1:5174';
const DRIVE_API_URL = `${DRIVE_API_BASE_URL}/api/drive/search`;
const VALUE_RE = /(?:R\$\s*)?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{2})?/g;
const CPF_RE = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
const CNPJ_RE = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
const DATA_RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const PROC_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

const DEFAULT_METRICS = {
  tempo: '·',
  tokens: '·',
  pag: '·',
  val: '·',
  min: '·',
  reg: '·',
  ent: '·',
  hip: '·',
};

const METRIC_LABELS = [
  ['Tempo', 'tempo'],
  ['Tokens', 'tokens'],
  ['Páginas', 'pag'],
  ['Valores', 'val'],
  ['Acima do mín.', 'min'],
  ['Regiões', 'reg'],
  ['Entidades', 'ent'],
  ['Hipóteses', 'hip', true],
];

const META_TEXT = {
  recorte: (event) => `${event.analyzed}/${event.totalPages} pág · ${event.lines} linhas`,
  valores: (event) => `${event.count} encontrados`,
  minimo: (event) => `${event.count} acima do mínimo`,
  regioes: (event) => `${event.count} criadas`,
  fusao: (event) => `${event.count} após fusão`,
  pontuacao: () => 'radicais aplicados',
  entidades: (event) => `${event.count} entidades`,
  associacao: () => 'vínculos definidos',
  consolidacao: (event) => `${event.count} hipóteses`,
};

function buildParams(config) {
  const start = config.pageStart ? Number(config.pageStart) : null;
  const end = config.pageEnd ? Number(config.pageEnd) : null;
  return {
    percent: Number(config.percent),
    pageStart: start && end ? start : null,
    pageEnd: start && end ? end : null,
    valorMinimo: Number(config.valorMinimo),
    janela: Number(config.janela),
    janelaCapa: Number(config.janelaCapa),
    multPrecator: Number(config.multPrecator),
    multCalcul: Number(config.multCalcul),
    topN: Number(config.topN),
  };
}

function parseProcessList(value) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripAccentsLower(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeComparableText(value) {
  return stripAccentsLower(value).replace(/\s+/g, ' ').trim();
}

function normalizeMoney(raw) {
  const parsed = Number.parseFloat(raw.replace(/R\$/, '').trim().replace(/[.\s]/g, '').replace(',', '.'));
  return Number.isNaN(parsed) ? null : parsed;
}

function looksMonetary(raw) {
  return /R\$/.test(raw) || /,\d{2}$/.test(raw) || /\d{2,}[.\s]\d{2}$/.test(raw);
}

function isJunkValueContext(line, matchIndex, matchText) {
  const around = line.slice(Math.max(0, matchIndex - 4), matchIndex + matchText.length + 4);
  if (CPF_RE.test(around)) return true;
  if (CNPJ_RE.test(around)) return true;
  if (PROC_RE.test(around)) return true;
  if (DATA_RE.test(around)) return true;
  const after = line.slice(matchIndex + matchText.length, matchIndex + matchText.length + 2);
  return /^\s*%/.test(after);
}

const MONEY_CONTEXT_RE = /\b(valor|saldo|credito|crédito|total|levanta|levantamento|requisit|precat|rpv|irrf|honor[aá]rios|quinhao|quinhão|pagamento|liquido|líquido|montante|principal|causa|deposito|depósito)\b/i;

function hasMoneyContext(line, prev = '', next = '') {
  return MONEY_CONTEXT_RE.test(line) || MONEY_CONTEXT_RE.test(prev) || MONEY_CONTEXT_RE.test(next) || /R\$/.test(line) || /R\$/.test(prev) || /R\$/.test(next);
}

function extractMoneyCandidatesFromLine(line, prev = '', next = '') {
  if (!hasMoneyContext(line, prev, next)) return [];
  VALUE_RE.lastIndex = 0;
  const values = [];
  let match;
  while ((match = VALUE_RE.exec(line)) !== null) {
    const raw = match[0].trim();
    if (!looksMonetary(raw)) continue;
    if (isJunkValueContext(line, match.index, raw)) continue;
    values.push(raw);
  }
  return values;
}

function pageHasValueAboveMinimum(text, minValue) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    VALUE_RE.lastIndex = 0;
    let match;
    while ((match = VALUE_RE.exec(line)) !== null) {
      const raw = match[0].trim();
      if (!looksMonetary(raw)) continue;
      if (isJunkValueContext(line, match.index, raw)) continue;
      const value = normalizeMoney(raw);
      if (value !== null && value >= minValue) return true;
    }
  }
  return false;
}

function looksLikeName(text) {
  const words = text.trim().split(/\s+/).filter((word) => !/^(da|de|do|das|dos|e)$/i.test(word));
  if (words.length < 2) return false;
  const normalized = stripAccentsLower(text);
  if (/^\d/.test(normalized)) return false;
  return !/^(processo|pag|pagina|documento|credito|saldo|valor|total|heranca|honorarios)/i.test(text.trim());
}

function splitNameTokens(name) {
  return stripAccentsLower(name)
    .split(/\s+/)
    .filter((word) => word && !/^(da|de|do|das|dos|e)$/i.test(word));
}

function nameMatchScore(text, nameTokens) {
  if (!text || !nameTokens.length) return { hits: 0, ratio: 0 };
  const normalized = normalizeComparableText(text);
  let hits = 0;
  nameTokens.forEach((token) => {
    if (normalized.includes(token)) hits += 1;
  });
  return {
    hits,
    ratio: hits / nameTokens.length,
  };
}

function matchesNameAnchor(text, nameTokens) {
  const { hits, ratio } = nameMatchScore(text, nameTokens);
  if (!nameTokens.length) return false;
  if (nameTokens.length <= 2) return hits === nameTokens.length;
  return ratio >= 0.6 && hits >= 2;
}

function isPrimaryCoverParty(line) {
  return /\b(exequente|autor|credor|beneficiario|beneficiária|autora|creedora)\b/i.test(line);
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

function distanceFactor(delta) {
  const distance = Math.abs(delta);
  if (distance === 0) return 1;
  if (distance <= 2) return 0.8;
  if (distance <= 5) return 0.55;
  if (distance <= 10) return 0.3;
  return 0.15;
}

function buildContextSnippet(lines, centerLine, radius = 4) {
  return lines
    .filter((line) => Math.abs(line.globalLine - centerLine) <= radius)
    .map((line) => line.text.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((text, index, arr) => arr.indexOf(text) === index)
    .join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedContext(snippet, name, valueRaw = '') {
  const tokens = splitNameTokens(name);
  const value = String(valueRaw || '').trim();
  if (!snippet || (!tokens.length && !value)) return snippet;

  const valuePattern = value ? escapeRegExp(value) : null;
  const namePattern = tokens.length ? tokens.map(escapeRegExp).join('|') : null;
  const pattern = [valuePattern, namePattern].filter(Boolean).join('|');
  const regex = new RegExp(`(${pattern})`, 'ig');

  return snippet.split('\n').map((line, lineIndex) => {
    const pieces = [];
    let cursor = 0;
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > cursor) {
        pieces.push(<span key={`${lineIndex}-t-${cursor}`}>{line.slice(cursor, match.index)}</span>);
      }
      const matched = match[0];
      const isValue = valuePattern && stripAccentsLower(matched) === stripAccentsLower(value);
      pieces.push(
        <mark className={isValue ? 'evidence-mark value' : 'evidence-mark name'} key={`${lineIndex}-m-${match.index}`}>
          {matched}
        </mark>
      );
      cursor = match.index + matched.length;
    }
    if (cursor < line.length) {
      pieces.push(<span key={`${lineIndex}-t-${cursor}`}>{line.slice(cursor)}</span>);
    }
    return (
      <div className="evidence-line" key={`${lineIndex}-${line.slice(0, 16)}`}>
        {pieces}
      </div>
    );
  });
}

const COVER_CONTEXT_RULES = [
  { regex: /\bsaldo a ser rateado\b/, weight: 220, tipo: 'ancora' },
  { regex: /\bcredito total\b/, weight: 180, tipo: 'ancora' },
  { regex: /\bvalor total\b/, weight: 150, tipo: 'ancora' },
  { regex: /\bvalor homologado\b/, weight: 140, tipo: 'ancora' },
  { regex: /\bsaldo homologado\b/, weight: 140, tipo: 'ancora' },
  { regex: /\bvalor devido\b/, weight: 120, tipo: 'ancora' },
  { regex: /\brateio\b/, weight: 90, tipo: 'ancora' },
  { regex: /\brateado\b/, weight: 90, tipo: 'ancora' },
  { regex: /\bquinhao\b/, weight: 70, tipo: 'ancora' },
  { regex: /\bpartilha\b/, weight: 60, tipo: 'ancora' },
  { regex: /\bmontante\b/, weight: 40, tipo: 'ancora' },
  { regex: /\bprecator\w*/g, weight: 30, tipo: 'precatorio' },
  { regex: /\bcalcul\w*/g, weight: 22, tipo: 'calculo' },
  { regex: /\bvalor\b|\bcredito\b|\btotal\b|\bhomolog\w*/g, weight: 20, tipo: 'ancora' },
  { regex: /\bhonor\w*|\boab\b|\bjuiz\b|\bcust\w*/g, weight: -25, tipo: 'negativo' },
];

function coverRuleLabel(source) {
  return source
    .replace(/^\\b/, '')
    .replace(/\\b$/, '')
    .replace(/\\w\*/g, '')
    .replace(/\\\//g, '/')
    .replace(/\|/g, ' / ')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function extractCoverNamesFromPages(pages) {
  const names = new Map();
  pages.forEach((page) => {
    page.text.split(/\r?\n/).forEach((rawLine) => {
      const text = rawLine.trim().replace(/\s+/g, ' ');
      if (!text) return;
      if (!isPrimaryCoverParty(text)) return;

      const beforeParen = text.split('(')[0].trim();
      const capsRegex = /(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}){1,5})/g;
      let capsMatch;
      capsRegex.lastIndex = 0;
      while ((capsMatch = capsRegex.exec(beforeParen)) !== null) {
        const candidate = capsMatch[0].trim().replace(/\s+/g, ' ');
        if (!candidate) continue;
        const titleCase = candidate
          .toLowerCase()
          .split(/\s+/)
          .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
          .join(' ');
        if (looksLikeName(titleCase)) {
          names.set(normalizeComparableText(titleCase), titleCase);
        }
      }

      const personRegex = /(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)(?:\s+(?:da|de|do|das|dos|e)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]?[a-záéíóúâêôãõç]*)*(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){1,5}/g;
      let match;
      personRegex.lastIndex = 0;
      while ((match = personRegex.exec(text)) !== null) {
        const name = match[0].trim().replace(/\s+/g, ' ');
        if (!looksLikeName(name)) continue;
        const around = text.slice(Math.max(0, match.index - 24), Math.min(text.length, match.index + name.length + 24));
        if (/\b(advogado|advogada|procurador|procuradora|terceiro interessado|executado|executada|inss|instituto nacional do seguro social|ceab|órgão|orgao)\b/i.test(around)) continue;
        names.set(normalizeComparableText(name), name);
      }
    });
  });
  return [...names.values()];
}

function extractLinkedLawyersFromPages(pages) {
  const lawyers = new Map();
  const keywords = /\b(advogado|advogada|procurador|procuradora|patrono|patrocinadora|escritorio|escritório|oab)\b/i;
  const genericNoise = /\b(partes?|procurador\/terceiro vinculado|terceiro vinculado|procurador|procuradora|vinculado|vinculada|terceiro interessado)\b/i;
  pages.forEach((page) => {
    page.text.split(/\r?\n/).forEach((rawLine) => {
      const text = rawLine.trim().replace(/\s+/g, ' ');
      if (!text || !keywords.test(text)) return;
      if (genericNoise.test(text) && !/\b[ÁÉÍÓÚÂÊÔÃÕÇA-Z][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){1,5}\b/.test(text)) return;

      const cleaned = text.split('(')[0].trim();
      const matches = cleaned.match(/(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)(?:\s+(?:da|de|do|das|dos|e)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]?[a-záéíóúâêôãõç]*)*(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){1,5}/g) || [];
      matches.forEach((candidate) => {
        const name = candidate.trim().replace(/\s+/g, ' ');
        if (!looksLikeName(name)) return;
        if (/\b(terceiro interessado|executado|executada|beneficiario|beneficiária|credor|credora|autor|autora|procurador|procuradora|partes?)\b/i.test(text)) return;
        if (/\b(inss|instituto nacional do seguro social|ceab|órgão|orgao)\b/i.test(text)) return;
        lawyers.set(normalizeComparableText(name), name);
      });
    });
  });
  return [...lawyers.values()];
}

function scoreCoverWindow(lines, valueLineIndex, valueLineText, nameTokens, anchorLineIndex, params) {
  let score = 100;
  const factors = [];
  const anchorText = stripAccentsLower(valueLineText);
  COVER_CONTEXT_RULES.forEach((rule) => {
    if (rule.weight <= 0) return;
    rule.regex.lastIndex = 0;
    if (!rule.regex.test(anchorText)) return;
    const mult = rule.tipo === 'precatorio'
      ? Number(params?.multPrecator || 1)
      : rule.tipo === 'calculo'
        ? Number(params?.multCalcul || 1)
        : 1;
    const contrib = Math.round(rule.weight * mult);
    score += contrib;
    factors.push({ radical: coverRuleLabel(rule.regex.source), tipo: rule.tipo, peso: rule.weight, dist: 0, fator: mult, hits: 1, contrib });
  });

  lines.forEach((line) => {
    const lineNorm = stripAccentsLower(line.text);
    const delta = line.globalLine - valueLineIndex;
    const factor = distanceFactor(delta);
    COVER_CONTEXT_RULES.forEach((rule) => {
      rule.regex.lastIndex = 0;
      if (!rule.regex.test(lineNorm)) return;
      const mult = rule.tipo === 'precatorio'
        ? Number(params?.multPrecator || 1)
        : rule.tipo === 'calculo'
          ? Number(params?.multCalcul || 1)
          : 1;
      const contrib = Math.round(rule.weight * factor * mult);
      score += contrib;
      factors.push({ radical: coverRuleLabel(rule.regex.source), tipo: rule.tipo, peso: rule.weight, dist: delta, fator: factor * mult, hits: 1, contrib });
    });
  });

  if (typeof anchorLineIndex === 'number') {
    const delta = Math.abs(anchorLineIndex - valueLineIndex);
    if (delta <= 2) score += 35;
    else if (delta <= 5) score += 20;
    else if (delta <= 10) score += 10;
  }

  factors.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
  return { score: Math.round(score), factors };
}

function runCoverMotorPipeline(valuePages, params, coverPages = []) {
  const startTime = Date.now();
  const totalPages = valuePages.length + coverPages.length;
  const audit = [];
  const names = extractCoverNamesFromPages(coverPages.length ? coverPages : valuePages.slice(0, Math.min(3, valuePages.length)));
  const coverLawyers = extractLinkedLawyersFromPages(coverPages.length ? coverPages : valuePages.slice(0, Math.min(3, valuePages.length)));
  const lawyers = coverLawyers.length ? coverLawyers : extractLinkedLawyersFromPages([...coverPages, ...valuePages]);
  const lines = [];
  valuePages.forEach((page) => {
    page.text.split(/\r?\n/).forEach((raw) => {
      lines.push({ globalLine: lines.length, page: page.page, text: raw });
    });
  });

  audit.push({
    key: 'scope',
    label: 'Recorte lido',
    meta: `${coverPages.length} pág. capa · ${valuePages.length} pág. de valores`,
    state: 'done',
  });
  audit.push({
    key: 'names',
    label: 'Nomes da capa',
    meta: names.length ? `${names.length} nome(s) · ${names.slice(0, 4).join(' | ')}` : 'nenhum nome reconhecido',
    state: names.length ? 'done' : 'active',
  });
  audit.push({
    key: 'lawyers',
    label: 'Advogados vinculados',
    meta: coverLawyers.length
      ? `${coverLawyers.length} vínculo(s) na capa · ${coverLawyers.slice(0, 4).join(' · ')}`
      : (lawyers.length ? `${lawyers.length} vínculo(s) no processo · ${lawyers.slice(0, 4).join(' · ')}` : 'nenhum advogado reconhecido'),
    state: lawyers.length ? 'done' : 'active',
  });

  const hypMap = new Map();
  names.forEach((name) => {
    const nameTokens = splitNameTokens(name);
    const nameNorm = normalizeComparableText(name);
    if (!nameNorm) return;

    const anchorHits = lines.filter((line, index) => {
      const prev = lines[index - 1]?.text || '';
      const next = lines[index + 1]?.text || '';
      const windowText = [prev, line.text, next].filter(Boolean).join(' ');
      return normalizeComparableText(windowText).includes(nameNorm) || matchesNameAnchor(windowText, nameTokens);
    });

    let candidateCount = 0;
    let acceptedCount = 0;

    anchorHits.forEach((anchorLine) => {
      const anchorLineIndex = anchorLine.globalLine;
      const coverWindow = Number(params.janelaCapa || 10);
      const windowStart = Math.max(0, anchorLineIndex - coverWindow);
      const windowEnd = Math.min(lines.length - 1, anchorLineIndex + coverWindow);
      const nearbyLines = lines.slice(windowStart, windowEnd + 1);

      nearbyLines.forEach((line) => {
        const prevText = lines[line.globalLine - 1]?.text || '';
        const nextText = lines[line.globalLine + 1]?.text || '';
        const rawMatches = extractMoneyCandidatesFromLine(line.text, prevText, nextText);
        if (!rawMatches.length) return;

        rawMatches.forEach((raw) => {
          candidateCount += 1;
          const value = normalizeMoney(raw);
          if (value === null || value < (params.valorMinimo || 0)) return;

          const valueWindowStart = Math.max(0, line.globalLine - params.janela);
          const valueWindowEnd = Math.min(lines.length - 1, line.globalLine + params.janela);
          const valueWindowLines = lines.slice(valueWindowStart, valueWindowEnd + 1);
          const scored = scoreCoverWindow(valueWindowLines, line.globalLine, line.text, nameTokens, anchorLineIndex, params);
          const key = `${nameNorm}|${Math.round(value)}|${line.page}`;
          const current = hypMap.get(key);
          const hypothesis = {
            id: `C${hypMap.size + 1}`,
            beneficiario: name,
            beneficiarioTipo: 'capa',
            valor: value,
            valorRaw: raw,
            page: line.page,
            line: line.globalLine,
            score: scored.score,
            factors: scored.factors,
            sections: [],
            contexto: buildContextSnippet(valueWindowLines, line.globalLine, 12),
            identificado: true,
            secundarios: [],
          };
          if (!current || current.score < hypothesis.score) {
            hypMap.set(key, hypothesis);
          }
          acceptedCount += 1;
        });
      });
    });

    audit.push({
      key: `name-${nameNorm}`,
      label: name,
      meta: `âncoras ${anchorHits.length} · candidatos ${candidateCount} · aceitos ${acceptedCount}`,
      state: anchorHits.length || candidateCount ? 'done' : 'active',
    });
  });

  let hipoteses = [...hypMap.values()];
  hipoteses.sort((a, b) => b.score - a.score);

  const maxScore = hipoteses.length ? hipoteses[0].score : 1;
  hipoteses.forEach((hipotese) => {
    hipotese.probabilidade = Math.max(5, Math.min(99, Math.round((hipotese.score / maxScore) * 92 + 7)));
  });

  hipoteses = hipoteses.slice(0, params.topN || 20);

  const elapsed = (Date.now() - startTime) / 1000;
  const charCount = valuePages.reduce((acc, page) => acc + page.text.length, 0) +
    coverPages.reduce((acc, page) => acc + page.text.length, 0);
  return {
    hipoteses,
    lawyers,
    audit,
    metrics: {
      tempo: elapsed,
      tokens: Math.round(charCount / 4),
      totalPages,
      analyzed: totalPages,
      valoresEncontrados: hipoteses.length,
      valoresAcimaMin: hipoteses.length,
      regioes: 0,
      entidades: names.length,
      hipoteses: hipoteses.length,
    },
  };
}

function evidenceStrength(factors = []) {
  let positive = 0;
  let negative = 0;
  let priority = 0;

  factors.forEach((factor) => {
    const contribution = Number(factor.contrib || 0);
    if (factor.tipo === 'precatorio' || factor.tipo === 'calculo') priority += Math.abs(contribution);
    else if (contribution >= 0) positive += contribution;
    else negative += Math.abs(contribution);
  });

  const total = positive + negative + priority || 1;
  return {
    positivePct: Math.round((positive / total) * 100),
    negativePct: Math.round((negative / total) * 100),
    priorityPct: Math.round((priority / total) * 100),
  };
}

function groupRowsByBeneficiary(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = normalizeComparableText(row.hypothesis?.beneficiario || 'Não identificado');
    const current = map.get(key);
    const item = {
      name: row.hypothesis?.beneficiario || 'Não identificado',
      rows: [row],
    };
    if (!current) {
      map.set(key, item);
      return;
    }
    current.rows.push(row);
  });

  return [...map.values()]
    .map((group) => ({
      ...group,
      rows: group.rows.sort((a, b) => b.hypothesis.probabilidade - a.hypothesis.probabilidade || b.hypothesis.score - a.hypothesis.score),
    }))
    .sort((a, b) => {
      const bestA = a.rows[0]?.hypothesis?.probabilidade || 0;
      const bestB = b.rows[0]?.hypothesis?.probabilidade || 0;
      return bestB - bestA || a.name.localeCompare(b.name, 'pt-BR');
    });
}

function groupDriveHypotheses(driveResults = [], limit = Infinity) {
  return driveResults.map((processResult) => {
    const rowMap = new Map();
    const lawyerMap = new Map();
    const fileMap = new Map();
    processResult.matches.forEach((file) => {
      if (file.url && !fileMap.has(file.url)) {
        fileMap.set(file.url, file);
      }
      (file.analysis?.lawyers || []).forEach((lawyer) => {
        lawyerMap.set(normalizeComparableText(lawyer), lawyer);
      });
      file.analysis?.hipoteses?.forEach((hypothesis) => {
        const strength = evidenceStrength(hypothesis.factors);
        const rowKey = [
          normalizeComparableText(hypothesis.beneficiario),
          Math.round(Number(hypothesis.valor || 0)),
        ].join('|');
        const existing = rowMap.get(rowKey);
        const rowItem = {
          id: `${processResult.process}-${file.id}-${hypothesis.id}`,
          process: processResult.process,
          file,
          hypothesis,
          pages: [hypothesis.page],
          files: [file.name],
          occurrences: 1,
          ...strength,
        };
        if (!existing) {
          rowMap.set(rowKey, rowItem);
          return;
        }
        existing.pages.push(hypothesis.page);
        existing.files.push(file.name);
        existing.occurrences += 1;
        existing.hypothesis.secundarios = [...(existing.hypothesis.secundarios || []), ...(hypothesis.secundarios || [])];
        if (hypothesis.score > existing.hypothesis.score) {
          existing.hypothesis = hypothesis;
          existing.file = file;
          existing.id = `${processResult.process}-${file.id}-${hypothesis.id}`;
          existing.positivePct = strength.positivePct;
          existing.negativePct = strength.negativePct;
          existing.priorityPct = strength.priorityPct;
        }
      });
    });

    const rows = [...rowMap.values()].map((row) => ({
      ...row,
      pages: [...new Set(row.pages)].sort((a, b) => a - b),
      files: [...new Set(row.files)],
    }));
    rows.sort((a, b) => b.hypothesis.probabilidade - a.hypothesis.probabilidade || b.hypothesis.score - a.hypothesis.score);
    const limitedRows = rows.slice(0, limit);

    return {
      process: processResult.process,
      status: processResult.status,
      fileCount: processResult.matches.length,
      primaryFile: processResult.matches.find((file) => file.url) || null,
      files: [...fileMap.values()],
      allRows: rows,
      rows: limitedRows,
      partyGroups: groupRowsByBeneficiary(limitedRows),
      lawyers: [...lawyerMap.values()],
      errors: processResult.matches.filter((file) => file.analysisError),
    };
  });
}

export default function App() {
  const mountedRef = useRef(true);
  const [status, setStatus] = useState({ mode: 'idle', text: 'Aguardando documento' });
  const [config, setConfig] = useState({
    percent: 25,
    pageStart: '',
    pageEnd: '',
    valorMinimo: 5000,
    janela: 20,
    janelaCapa: 10,
    multPrecator: 3,
    multCalcul: 2,
    topN: 20,
    minProbabilidade: 0,
  });
  const [pages, setPages] = useState(null);
  const [pdfSource, setPdfSource] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [streamVisible, setStreamVisible] = useState(false);
  const [streamRows, setStreamRows] = useState([]);
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [driveResults, setDriveResults] = useState(null);
  const [driveMeta, setDriveMeta] = useState(null);
  const [pdfProgress, setPdfProgress] = useState('');
  const [expandedEvidence, setExpandedEvidence] = useState({});
  const [processList, setProcessList] = useState(`0000032-20.2004.4.01.4100
0003044-56.2014.4.01.3400`);
  const processNumbers = parseProcessList(processList);
  const tableGroups = Array.isArray(driveResults) ? groupDriveHypotheses(driveResults, config.topN) : [];
  const visibleTableGroups = tableGroups.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => row.hypothesis.probabilidade >= config.minProbabilidade),
    partyGroups: groupRowsByBeneficiary(group.rows.filter((row) => row.hypothesis.probabilidade >= config.minProbabilidade)),
  }));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function setReady(text) {
    setStatus({ mode: 'ready', text });
  }

  function updateConfig(key, value) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function toggleEvidence(rowId) {
    setExpandedEvidence((current) => ({ ...current, [rowId]: !current[rowId] }));
  }

  async function runAnalysis() {
    if (!processNumbers.length) {
      setError('Preencha ao menos um número de processo.');
      return;
    }
    setError('');
    setRunning(true);
    setStatus({ mode: 'run', text: 'Buscando no Drive' });
    setPdfProgress('');
    setDriveResults([]);
    setDriveMeta(null);
    setStreamVisible(false);
    setStreamRows([]);

    try {
      const startedAt = performance.now();
      const response = await fetch(DRIVE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderUrl: DRIVE_FOLDER_URL,
          processes: processNumbers,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Erro ao buscar arquivos no Google Drive.');
      }
      if (!mountedRef.current) return;
      const params = buildParams(config);
      setStatus({ mode: 'run', text: 'Analisando PDFs' });
      const analyzedResults = [];
      const auditRows = [
        {
          key: 'drive-search',
          label: 'Busca no Drive',
          meta: `${payload.scannedFiles} arquivo(s) varridos`,
          state: 'done',
        },
        {
          key: 'process-list',
          label: 'Processos informados',
          meta: `${processNumbers.length} processo(s)`,
          state: 'done',
        },
      ];

      for (const [index, item] of payload.results.entries()) {
        const analyzedItem = { ...item, matches: [...item.matches] };
        if (item.matches.length) {
          analyzedItem.matches = [];
          for (const file of item.matches) {
            setPdfProgress(`Analisando ${file.name} (${index + 1}/${payload.results.length})`);
            try {
              const response = await fetch(`${DRIVE_API_BASE_URL}/api/drive/files/${file.id}/download`);
              if (!response.ok) {
                const text = await response.text();
                throw new Error(text || `Falha ao baixar ${file.name}.`);
              }
              const buffer = await response.arrayBuffer();
              const bufferBytes = new Uint8Array(buffer);
              const coverPagesFromDrive = await extractCoverPagesFromBuffer(bufferBytes.slice(), file.name);
              const pagesFromDrive = await extractAllPagesFromBuffer(bufferBytes.slice(), params, file.name);
              const analysis = runCoverMotorPipeline(pagesFromDrive, params, coverPagesFromDrive);
              analyzedItem.matches.push({ ...file, analysis, pagesAnalyzed: pagesFromDrive.length + coverPagesFromDrive.length });
              auditRows.push({
                key: `${file.id}-file`,
                label: file.name,
                meta: `${pagesFromDrive.length} pág. de valores · ${coverPagesFromDrive.length} pág. de capa · ${analysis.hipoteses.length} hipótese(s)`,
                state: analysis.hipoteses.length ? 'done' : 'active',
              });
              auditRows.push(...analysis.audit.map((row, rowIndex) => ({
                ...row,
                key: `${file.id}-${rowIndex}-${row.key}`,
              })));
            } catch (analysisError) {
              analyzedItem.matches.push({ ...file, analysisError: analysisError.message });
              auditRows.push({
                key: `${file.id}-error`,
                label: file.name,
                meta: analysisError.message,
                state: 'active',
              });
            }
            if (mountedRef.current) {
              setStreamRows([...auditRows]);
              setStreamVisible(true);
            }
          }
        }
        analyzedResults.push(analyzedItem);
        if (mountedRef.current) setDriveResults([...analyzedResults, ...payload.results.slice(index + 1)]);
      }

      if (!mountedRef.current) return;
      const foundCount = analyzedResults.filter((item) => item.status === 'found').length;
      const aggregate = analyzedResults.reduce((acc, item) => {
        item.matches.forEach((file) => {
          if (!file.analysis) return;
          acc.tokens += file.analysis.metrics.tokens;
          acc.pages += file.analysis.metrics.analyzed;
          acc.values += file.analysis.metrics.valoresEncontrados;
          acc.aboveMin += file.analysis.metrics.valoresAcimaMin;
          acc.entities += file.analysis.metrics.entidades;
          acc.hypotheses += file.analysis.metrics.hipoteses;
        });
        return acc;
      }, { tokens: 0, pages: 0, values: 0, aboveMin: 0, entities: 0, hypotheses: 0 });

      setDriveResults(analyzedResults);
      setDriveMeta(payload);
      setMetrics({
        tempo: `${((performance.now() - startedAt) / 1000).toFixed(2)}s`,
        tokens: aggregate.tokens ? aggregate.tokens.toLocaleString('pt-BR') : '·',
        pag: aggregate.pages || '·',
        val: payload.scannedFiles,
        min: aggregate.aboveMin || foundCount,
        reg: payload.results.length - foundCount,
        ent: aggregate.entities || payload.results.length,
        hip: aggregate.hypotheses || foundCount,
      });
      setStreamRows(auditRows);
      setStreamVisible(true);
      setPdfProgress('');
      setStatus({ mode: 'ready', text: 'Análise concluída' });
    } catch (err) {
      setError(`Erro na análise: ${err.message}`);
      setStatus({ mode: 'ready', text: 'Erro' });
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }

  async function readPdfPageText(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = {};
    content.items.forEach((item) => {
      const y = Math.round(item.transform[5]);
      if (!rows[y]) rows[y] = [];
      rows[y].push([item.transform[4], item.str]);
    });
    return Object.keys(rows)
      .map(Number)
      .sort((a, b) => b - a)
      .map((y) => rows[y].sort((a, b) => a[0] - b[0]).map((pair) => pair[1]).join(' '))
      .join('\n');
  }

  function buildPageScope(totalPages, params) {
    if (params.pageStart && params.pageEnd) {
      const pagesInRange = [];
      for (let pageNumber = Math.max(1, params.pageStart); pageNumber <= Math.min(params.pageEnd, totalPages); pageNumber += 1) {
        pagesInRange.push(pageNumber);
      }
      return pagesInRange;
    }

    const count = params.percent && params.percent < 100
      ? Math.max(1, Math.round((totalPages * params.percent) / 100))
      : totalPages;
    const firstPage = Math.max(1, totalPages - count + 1);
    const pagesInScope = [];
    for (let pageNumber = firstPage; pageNumber <= totalPages; pageNumber += 1) {
      pagesInScope.push(pageNumber);
    }
    return pagesInScope;
  }

  function buildCoverScope(totalPages, limit = 3) {
    const count = Math.max(1, Math.min(limit, totalPages));
    const pages = [];
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      pages.push(pageNumber);
    }
    return pages;
  }

  async function extractPdfPagesFromBuffer(buffer, params, fileName) {
    if (typeof window.pdfjsLib === 'undefined') {
      throw new Error('A biblioteca de leitura de PDF não carregou.');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      verbosity: window.pdfjsLib.VerbosityLevel?.ERRORS ?? 0,
    }).promise;
    const totalPages = pdf.numPages;

    const scope = buildPageScope(totalPages, params);
    const cache = new Map();
    const candidatePages = new Set();
    const reversedScope = [...scope].reverse();

    for (let index = 0; index < reversedScope.length; index += 1) {
      const pageNumber = reversedScope[index];
      setPdfProgress(`Rastreando valores em ${fileName}: página ${pageNumber} (${index + 1}/${reversedScope.length})`);
      const text = await readPdfPageText(pdf, pageNumber);
      cache.set(pageNumber, text);
      if (!pageHasValueAboveMinimum(text, params.valorMinimo || 0)) continue;

      for (let nearby = pageNumber - 1; nearby <= pageNumber + 1; nearby += 1) {
        if (nearby >= 1 && nearby <= totalPages) candidatePages.add(nearby);
      }
    }

    if (!candidatePages.size && cache.size) {
      for (const pageNumber of cache.keys()) {
        candidatePages.add(pageNumber);
      }
    }

    const pageNumbers = [...candidatePages].sort((a, b) => a - b);
    const extractedPages = [];
    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      setPdfProgress(`Lendo região candidata em ${fileName}: página ${pageNumber} (${index + 1}/${pageNumbers.length})`);
      const text = cache.get(pageNumber) || await readPdfPageText(pdf, pageNumber);
      extractedPages.push({ page: pageNumber, text });
    }
    return extractedPages;
  }

  async function extractAllPagesFromBuffer(buffer, params, fileName) {
    if (typeof window.pdfjsLib === 'undefined') {
      throw new Error('A biblioteca de leitura de PDF não carregou.');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      verbosity: window.pdfjsLib.VerbosityLevel?.ERRORS ?? 0,
    }).promise;
    const totalPages = pdf.numPages;
    const pageNumbers = buildPageScope(totalPages, params);
    const pagesAll = [];
    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      setPdfProgress(`Lendo páginas em ${fileName}: página ${pageNumber} (${index + 1}/${pageNumbers.length})`);
      const text = await readPdfPageText(pdf, pageNumber);
      pagesAll.push({ page: pageNumber, text });
    }
    return pagesAll;
  }

  async function extractCoverPagesFromBuffer(buffer, fileName) {
    if (typeof window.pdfjsLib === 'undefined') {
      throw new Error('A biblioteca de leitura de PDF não carregou.');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      verbosity: window.pdfjsLib.VerbosityLevel?.ERRORS ?? 0,
    }).promise;
    const totalPages = pdf.numPages;
    const pageNumbers = buildCoverScope(totalPages, 3);
    const pagesAll = [];
    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      setPdfProgress(`Lendo capa em ${fileName}: página ${pageNumber} (${index + 1}/${pageNumbers.length})`);
      const text = await readPdfPageText(pdf, pageNumber);
      pagesAll.push({ page: pageNumber, text });
    }
    return pagesAll;
  }

  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <div className="brand compact">
            <div className="mark">Extrator<span className="arrow">→</span>Precatórios</div>
          </div>
          <div className="top-status-wrap">
            <div className={`status ${status.mode === 'ready' ? 'ready' : ''} ${status.mode === 'run' ? 'run' : ''}`}>
              <span className="dot" />
              <span>{status.text}</span>
            </div>
            {pdfProgress ? <div className="progress-pill">{pdfProgress}</div> : null}
          </div>
        </div>
      </header>

      <div className="wrap grid">
        <aside className="panel">
          <div className="cfg">
            <h2>Camada 1 · Extração</h2>
            <div className="cfg-body">
              <div className="field">
                <label>Percentual do documento</label>
                <div className="seg">
                  {[100, 75, 50, 25].map((value) => (
                    <button key={value} data-v={value} aria-pressed={config.percent === value} onClick={() => updateConfig('percent', value)}>
                      {value}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Valor mínimo</label>
                <div className="seg">
                  {[
                    [1000, 'R$ 1.000'],
                    [5000, 'R$ 5.000'],
                    [10000, 'R$ 10.000'],
                    [50000, 'R$ 50.000'],
                  ].map(([value, label]) => (
                    <button key={value} data-v={value} aria-pressed={config.valorMinimo === value} onClick={() => updateConfig('valorMinimo', value)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="hint">Valores abaixo não abrem regiões próprias.</div>
              </div>

              <div className="field">
                <label>Janela da região</label>
                <div className="seg">
                  {[10, 20, 30].map((value) => (
                    <button key={value} data-v={value} aria-pressed={config.janela === value} onClick={() => updateConfig('janela', value)}>
                      {value} linhas
                    </button>
                  ))}
                </div>
                <div className="hint">Linhas acima e abaixo de cada valor.</div>
              </div>

              <div className="field">
                <label>Janela da capa</label>
                <div className="seg">
                  {[5, 10, 15, 20].map((value) => (
                    <button key={value} data-v={value} aria-pressed={config.janelaCapa === value} onClick={() => updateConfig('janelaCapa', value)}>
                      {value} linhas
                    </button>
                  ))}
                </div>
                <div className="hint">Linhas antes e depois do nome da capa.</div>
              </div>

              <div className="field">
                <label>Multiplicador PRECATÓRIO</label>
                <div className="seg">
                  {[1, 2, 3, 5].map((value) => (
                    <button key={value} data-v={value} aria-pressed={config.multPrecator === value} onClick={() => updateConfig('multPrecator', value)}>
                      {value}×
                    </button>
                  ))}
                </div>
                <div className="hint">Peso base 100. Maior peso individual do sistema.</div>
              </div>

              <div className="field">
                <label>Multiplicador CÁLCULO</label>
                <div className="seg">
                  {[1, 2, 3, 5].map((value) => (
                    <button key={value} data-v={value} aria-pressed={config.multCalcul === value} onClick={() => updateConfig('multCalcul', value)}>
                      {value}×
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Máximo de resultados por processo</label>
                <div className="seg">
                  {[
                    [10, 'Top 10'],
                    [20, 'Top 20'],
                    [50, 'Top 50'],
                  ].map(([value, label]) => (
                    <button key={value} data-v={value} aria-pressed={config.topN === value} onClick={() => updateConfig('topN', value)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Força mínima de saída</label>
                <div className="seg">
                  {[
                    [0, 'Sem corte'],
                    [70, '70%'],
                    [80, '80%'],
                    [90, '90%'],
                    [95, '95%'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      data-v={value}
                      aria-pressed={config.minProbabilidade === value}
                      onClick={() => updateConfig('minProbabilidade', value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="hint">Filtra só a saída exibida. Não mexe na análise interna.</div>
              </div>

              <div className="field">
                <label>Pasta fixa do Drive</label>
                <div className="drive-box">
                  <a href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">{DRIVE_FOLDER_URL}</a>
                </div>
                <div className="hint">Os arquivos serão procurados sempre nessa pasta.</div>
              </div>

            </div>
          </div>

        </aside>

        <main>
          <section className="input-block">
            <div className="card-h">
              <h2 className="t">Números dos arquivos</h2>
              <span className="n">Entrada</span>
            </div>
            <div className="card-b">
              <div className="field" style={{ marginTop: 0, marginBottom: 16 }}>
                <textarea
                  value={processList}
                  onChange={(event) => setProcessList(event.target.value)}
                  placeholder="Cole um número de processo por linha"
                  className="process-list"
                />
                <div className="hint">Um processo por linha, por exemplo: `0000032-20.2004.4.01.4100`.</div>
              </div>

              <button className="run" disabled={!processNumbers.length || running} onClick={runAnalysis}>Executar análise <span className="arrow">→</span></button>
              {error ? <div className="err">{error}</div> : null}
            </div>
          </section>

          {streamVisible && (
            <div className="card">
              <div className="card-h"><span className="t">Execução</span><span className="n">Camada 3 · Streaming</span></div>
              <div className="stream">
                {streamRows.map((row) => (
                  <div key={row.key} className={`srow ${row.state}`}>
                    <span className="ic">✓</span>
                    <span className="nm">{row.label}</span>
                    <span className="meta">{row.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-h"><span className="t">Hipóteses</span><span className="n">Camada 5 · Saída</span></div>
            <div className="card-b results-pad">
              {driveResults === null && (
                <div className="empty">
                  <div className="e1">Nenhuma análise executada</div>
                  <div className="e2">Informe os números de processo e execute para buscar os PDFs na pasta fixa.</div>
                </div>
              )}

              {Array.isArray(driveResults) && driveResults.length === 0 && (
                <div className="empty">
                  <div className="e2">{running ? 'Buscando no Drive...' : 'Nenhum processo informado.'}</div>
                </div>
              )}

              {visibleTableGroups.some((group) => group.rows.length > 0) ? (
                <div className="process-table-list">
                  {visibleTableGroups.map((group) => (
                    <section className="process-table-group" key={group.process}>
                      <div className="process-table-head">
                        <div className="process-head-copy">
                          {group.primaryFile?.url ? (
                            <a className="process-title process-link" href={group.primaryFile.url} target="_blank" rel="noreferrer">
                              {group.process}
                            </a>
                          ) : (
                            <div className="process-title">{group.process}</div>
                          )}
                          <div className="process-lawyers-panel">
                            <div className="process-lawyers-label">Advogados vinculados</div>
                            {group.lawyers?.length ? (
                              <div className="process-lawyers-list">
                                {group.lawyers.slice(0, 6).map((lawyer) => (
                                  <span className="lawyer-chip" key={`${group.process}-${lawyer}`}>{lawyer}</span>
                                ))}
                                {group.lawyers.length > 6 ? (
                                  <span className="lawyer-chip lawyer-chip-more">+{group.lawyers.length - 6}</span>
                                ) : null}
                              </div>
                            ) : (
                              <div className="process-lawyers-empty">Não identificados na capa nem no processo</div>
                            )}
                          </div>
                          <div className="process-subtitle">{group.fileCount} arquivo(s) encontrado(s) · {group.rows.length} hipótese(s) · {group.partyGroups.length} parte(s)</div>
                        </div>
                        <span className={`chip ${group.status === 'found' ? 'benef' : 'sec'}`}>{group.status === 'found' ? 'encontrado' : 'não encontrado'}</span>
                      </div>

                      {group.partyGroups.length > 0 ? (
                        <div className="results-ledger">
                          <div className="results-ledger-head">
                            <div>Parte</div>
                            <div>Valor</div>
                            <div>Página</div>
                            <div>Evidência</div>
                          </div>
                          <div className="results-ledger-body">
                            {group.rows.map((row, index) => (
                              <article className="results-ledger-row" key={row.id}>
                                <div className="ledger-rank mono">{String(index + 1).padStart(2, '0')}</div>
                                <div className="ledger-party">
                                  <div className="party-name table-party">{row.hypothesis.beneficiario}</div>
                                  <div className="table-sub mono">
                                    {row.occurrences > 1 ? `${row.occurrences} ocorrências · ` : ''}
                                    {row.hypothesis.probabilidade}%
                                  </div>
                                </div>
                                <div className="ledger-value">
                                  <div className="money">{fmtBRL(row.hypothesis.valor)}</div>
                                </div>
                                <div className="ledger-page">
                                  <div className="table-sub mono">pág. {row.hypothesis.page}</div>
                                  <div className="table-sub mono muted">{row.pages.length} pág(s).</div>
                                </div>
                                <div className="ledger-evidence">
                                  {row.hypothesis.contexto ? (
                                    <div className="evidence-toggle-wrap">
                                      <div className="evidence-party">
                                        <span className="evidence-party-label">Parte vinculada</span>
                                        <span className="evidence-party-name">{row.hypothesis.beneficiario}</span>
                                      </div>
                                      <button
                                        type="button"
                                        className="evidence-toggle"
                                        onClick={() => toggleEvidence(row.id)}
                                        aria-expanded={!!expandedEvidence[row.id]}
                                      >
                                        <span className="evidence-toggle-icon">{expandedEvidence[row.id] ? '−' : '+'}</span>
                                        <span>{expandedEvidence[row.id] ? 'ocultar' : 'ver'}</span>
                                      </button>
                                      {expandedEvidence[row.id] ? (
                                        <div className="evidence-snippet ledger-evidence-snippet">
                                          {renderHighlightedContext(row.hypothesis.contexto, row.hypothesis.beneficiario, row.hypothesis.valorRaw || fmtBRL(row.hypothesis.valor))}
                                        </div>
                                      ) : (
                                        <div className="evidence-preview ledger-evidence-snippet">
                                          {String(row.hypothesis.contexto).trim().replace(/\s+/g, ' ').slice(0, 120)}
                                          {String(row.hypothesis.contexto).trim().replace(/\s+/g, ' ').length > 120 ? '…' : ''}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="table-sub mono muted">sem evidência</div>
                                  )}
                                </div>
                              </article>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="process-empty">Nenhuma hipótese acima dos critérios atuais para este processo.</div>
                      )}

                    </section>
                  ))}
                </div>
              ) : null}

              {Array.isArray(driveResults) &&
              driveResults.length > 0 &&
              !visibleTableGroups.some((group) => group.rows.length > 0) &&
              !running ? (
                <div className="empty">
                  <div className="e1">Nenhuma hipótese encontrada</div>
                  <div className="e2">Os arquivos foram localizados, mas a análise não encontrou candidatos acima dos critérios atuais.</div>
                </div>
              ) : null}

            </div>
          </div>
        </main>
      </div>

      <footer className="dock">
        <section className="metrics">
          <div className="wrap">
            <div className="metrics-inner">
              {METRIC_LABELS.map(([label, key, accent]) => (
                <div className="metric" key={key}>
                  <div className="k">{label}</div>
                  <div className={`v ${accent ? 'accent' : ''}`}>{metrics[key]}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </footer>
    </>
  );
}
