'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCORE_BANDS = Object.freeze([
  { min: 1, max: 10, name: 'low' },
  { min: 11, max: 30, name: 'review' },
  { min: 31, max: 50, name: 'serious' },
  { min: 51, max: 100, name: 'prohibited' }
]);

const DEFAULT_RULES = Object.freeze([
  { pattern: /\b(damn|hell|crap)\b/gi, points: 5, category: 'profanity' },
  { pattern: /\b(shit|fuck|bitch|asshole)\b/gi, points: 20, category: 'heavy-profanity' },
  { pattern: /\b(idiot|moron|stupid|dumbas(?:s)?|dumb)\b/gi, points: 20, category: 'insult' },
  { pattern: /\b(awful|worthless)\b/gi, points: 8, category: 'harassment' },
  { pattern: /\b(kill yourself|go die|you should die|going to hurt you|hurt you)\b/gi, points: 35, category: 'threat' },
  { pattern: /\b(nazi|white power|racial slur)\b/gi, points: 55, category: 'hate-speech' },
  { pattern: /\b(fag|retard)\b/gi, points: 55, category: 'hate-speech' },
  { pattern: /\b(people from|those|that)\s+(group|community)\b.*\b(disgusting|inferior|dirty)\b/gi, points: 40, category: 'hate' },
  { pattern: /\b(explicit sexual content|sexually explicit|sexual material|sexual content)\b/gi, points: 30, category: 'sexual-content' },
  { pattern: /\b(hurt myself|harm myself|intention to hurt myself|want to hurt myself|thinking about hurting myself|suicidal|suicide)\b/gi, points: 45, category: 'self-harm' },
  { pattern: /\b(dangerous challenge|unsafe challenge|dangerous stunt|unsafe stunt)\b/gi, points: 25, category: 'dangerous-activity' },
  { pattern: /\b(bypass|evade|avoid|beat|defeat|get around)\s+(the\s+)?(filter|moderation|moderator|safety filter)\b/gi, points: 15, category: 'moderation-evasion' }
]);

const CONTEXT_RULES = Object.freeze([
  { pattern: /\b(you|you're|youre|ur)\s+(an?\s+)?(idiot|moron|stupid|loser|jerk)\b/gi, points: 12, category: 'targeted-insult' },
  { pattern: /\b(fuck|shit|bitch)\s+(you|him|her|them)\b/gi, points: 20, category: 'targeted-profanity' },
  { pattern: /\b(you|him|her|them)\s+(are|is)\s+(a\s+)?(fuck|asshole|bitch|idiot|moron)\b/gi, points: 20, category: 'targeted-abuse' },
  { pattern: /\b(you|you're|youre|ur)\s+(so\s+)?(awful|worthless|pathetic|useless|disgusting)\b/gi, points: 15, category: 'harassment' },
  { pattern: /\b(nobody likes you|everyone hates you)\b/gi, points: 15, category: 'harassment' },
  { pattern: /\b(i|we)\s+(am|are|'m|'re)?\s*(going to|gonna|will|'ll)\s+(hurt|harm|attack)\s+(you|them|him|her)\b/gi, points: 45, category: 'threat' },
  { pattern: /\b(i|we)\s+(will|'ll)\s+(get|come for)\s+(you|them|him|her)\b/gi, points: 40, category: 'threat' },
  { pattern: /\b(those|these|all|people from)\s+(people|members|users|groups|communities)\s+(are|should be)\s+(disgusting|inferior|dirty|worthless)\b/gi, points: 40, category: 'identity-harassment' },
  { pattern: /\b(add spaces|use symbols|spell it weird|spell it with spaces)\b/gi, points: 10, category: 'moderation-evasion' }
]);

const LEET_MAP = Object.freeze({ '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b' });
const HOMOGLYPH_MAP = Object.freeze({ 'а': 'a', 'А': 'a', 'е': 'e', 'Е': 'e', 'і': 'i', 'І': 'i', 'о': 'o', 'О': 'o', 'р': 'p', 'Р': 'p', 'с': 'c', 'С': 'c', 'х': 'x', 'Х': 'x', 'у': 'y', 'У': 'y', 'ѕ': 's', 'Ѕ': 's' });

function loadBadWords(filePath = path.join(__dirname, 'bad-words.txt')) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word && !word.startsWith('#'));
}

const BAD_WORDS = Object.freeze(loadBadWords());
const CURATED_WORDS = new Set('damn hell crap shit fuck bitch asshole idiot moron stupid awful worthless nazi power racial slur fag retard people from those that group community disgusting inferior dirty explicit sexual content sexually explicit sexual material sexual content hurt myself harm myself intention to hurt myself want to hurt myself thinking about hurting myself suicidal suicide dangerous challenge unsafe challenge dangerous stunt unsafe stunt bypass evade avoid beat defeat get around filter moderation moderator safety filter'.split(' '));
const BAD_WORD_RULES = Object.freeze(BAD_WORDS.map((word) => ({
  pattern: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
  points: 20,
  category: 'bad-word-list'
})).filter((rule, index) => !CURATED_WORDS.has(BAD_WORDS[index])));

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function normalize(text) {
  return Array.from(String(text || ''))
    .map((character) => HOMOGLYPH_MAP[character] || character)
    .join('')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/[01!|345@$78]/g, (character) => LEET_MAP[character] || character)
    .replace(/[\s._\-+=~`^*|/\\:,;!?()[\]{}<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bandFor(score) {
  if (score === 0) return 'safe';
  return SCORE_BANDS.find((band) => score >= band.min && score <= band.max)?.name || 'safe';
}

function quotedRanges(text) {
  const source = String(text || '');
  const ranges = [];
  const add = (pattern) => {
    let match;
    while ((match = pattern.exec(source)) !== null) ranges.push([match.index, match.index + match[0].length]);
  };
  add(/`[\s\S]*?`/g);
  add(/(^|\n)\s*>[^\n]*/g);
  add(/“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/g);
  return ranges.sort((left, right) => left[0] - right[0]);
}

function withoutQuotedText(text) {
  const source = String(text || '');
  let result = '';
  let cursor = 0;
  for (const [start, end] of quotedRanges(source)) {
    if (start < cursor) continue;
    result += source.slice(cursor, start) + ' ';
    cursor = end;
  }
  return result + source.slice(cursor);
}

function urlsIn(text) {
  return String(text || '').match(/\bhttps?:\/\/[^\s<>()]+/gi) || [];
}

function regexMatches(pattern, text) {
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return String(text || '').match(regex) || [];
}

function matchesRule(rule, text) {
  const normalized = normalize(text);
  const compact = normalized.replace(/\s+/g, '');
  const candidates = [normalized, compact];
  const hasSeparatedLetters = /(?:^|\s)(?:[a-z]\s+){2,}[a-z](?=\s|$)/i.test(normalized);
  const matches = new Set();
  candidates.forEach((candidate, index) => {
    if (!candidate || (index === 1 && !hasSeparatedLetters)) return;
    const pattern = index === 1 ? new RegExp(rule.pattern.source.replace(/\\b/g, ''), rule.pattern.flags) : rule.pattern;
    regexMatches(pattern, candidate).forEach((match) => matches.add(match.toLowerCase()));
  });
  return [...matches];
}

function scoreText(text, rules, findings, source = 'text') {
  let score = 0;
  rules.forEach((rule) => {
    const matches = matchesRule(rule, text);
    if (!matches.length) return;
    const points = clamp(rule.points);
    findings.push({ category: rule.category, points, matches: matches.length, source });
    score += points * matches.length;
  });
  return score;
}

function contextScore(text, previousMessages, findings) {
  const normalized = normalize(text);
  let score = 0;
  if (/\b(fuck|shit|bitch|asshole|idiot|moron|stupid)\s+(you|him|her|them)\b/i.test(normalized)) {
    findings.push({ category: 'direct-abuse', points: 12, matches: 1, source: 'context' });
    score += 12;
  }
  if (/\b(you|you're|youre|ur)\b.*\b(idiot|moron|stupid|worthless|pathetic|loser)\b/i.test(normalized)) {
    findings.push({ category: 'targeted-harassment', points: 10, matches: 1, source: 'context' });
    score += 10;
  }
  if ((String(text).match(/[!?]{5,}/g) || []).length) {
    findings.push({ category: 'aggressive-formatting', points: 2, matches: 1, source: 'context' });
    score += 2;
  }
  if (Array.isArray(previousMessages)) {
    const repeated = previousMessages.filter((message) => normalize(typeof message === 'string' ? message : message?.text) === normalized).length;
    if (normalized && repeated >= 2) {
      findings.push({ category: 'repeated-targeting', points: 18, matches: 1, source: 'context' });
      score += 18;
    }
  }
  return score;
}

function scanContent(input = {}, options = {}) {
  const type = input.type || 'text';
  let text = input.text;
  let extraction = 'direct';
  if (type === 'pdf' && Buffer.isBuffer(text)) {
    if (typeof options.extractText !== 'function') return { badScore: 0, band: 'safe', status: 'needs-extraction', findings: [], urls: [], quotedTextExcluded: true, extraction: 'unavailable' };
    text = options.extractText(text, input);
    extraction = 'provided-extractor';
  }
  text = String(text || '');
  const quotedTextApplies = ['file', 'pdf', 'url', 'website'].includes(type);
  const scanText = quotedTextApplies ? withoutQuotedText(text) : text;
  const findings = [];
  let score = scoreText(scanText, [...(options.rules || [...DEFAULT_RULES, ...BAD_WORD_RULES]), ...CONTEXT_RULES], findings);
  urlsIn(text).forEach((url) => { const urlFindings = []; score += Math.min(10, scoreText(url, options.rules || DEFAULT_RULES, urlFindings, 'url')); urlFindings.forEach((finding) => findings.push(finding)); });
  score += contextScore(scanText, input.previousMessages, findings);
  const badScore = clamp(score);
  return { badScore, band: bandFor(badScore), status: 'scanned', findings, urls: urlsIn(text), quotedTextExcluded: quotedTextApplies, extraction };
}

function createContentSafetyAdapter({ provider, fallbackOptions } = {}) {
  return { async scan(input) { return provider?.scan ? provider.scan(input) : scanContent(input, fallbackOptions); } };
}

module.exports = { BAD_WORDS, DEFAULT_RULES, SCORE_BANDS, createContentSafetyAdapter, scanContent };
