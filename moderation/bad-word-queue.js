'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-3.5-content-safety:free';
const DEFAULT_QUEUE_PATH = path.join(__dirname, 'bad-word-queue.txt');
const DEFAULT_CHECKPOINT_PATH = path.join(__dirname, 'bad-word-checkpoint.txt');
const DEFAULT_PRESET_BAD_WORDS_PATH = path.join(__dirname, 'bad-words.txt');
const DEFAULT_USER_BAD_WORDS_PATH = path.join(__dirname, 'user-bad-words.txt');
const DEFAULT_DISCARD_PATH = path.join(__dirname, 'bad-word-discard.txt');
const DEFAULT_INSTRUCTIONS_PATH = path.join(__dirname, 'ai-mod-instructions.txt');

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'he', 'her', 'him',
  'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'that', 'the', 'their',
  'them', 'there', 'they', 'this', 'to', 'too', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'who', 'why',
  'will', 'with', 'you', 'your', 'yourself', 'yr', 'yours', 'about', 'after', 'before', 'because', 'into', 'over',
  'under', 'while', 'through', 'some', 'many', 'more', 'most', 'very', 'just', 'also'
]);

function ensureFile(filePath) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf8');
}

function readLines(filePath) {
  ensureFile(filePath);
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith('#'));
}

function writeCheckpoint(filePath, value) {
  ensureFile(filePath);
  fs.writeFileSync(filePath, String(value), 'utf8');
}

function appendUniqueLine(filePath, value) {
  ensureFile(filePath);
  const entry = String(value || '').trim().toLowerCase();
  if (!entry) return false;
  const existing = fs.readFileSync(filePath, 'utf8');
  const lines = existing.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean);
  if (lines.includes(entry)) return false;
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(filePath, `${prefix}${entry}\n`, 'utf8');
  return true;
}

function writeQueueFile(filePath, entries) {
  ensureFile(filePath);
  const normalized = Array.from(new Set(entries.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)));
  fs.writeFileSync(filePath, normalized.length ? `${normalized.join('\n')}\n` : '', 'utf8');
}

function sanitizeCandidate(value) {
  const token = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!token) return '';

  const words = token.split(/\s+/).map((word) => word.replace(/^'+|'+$/g, '').replace(/[^a-z0-9\-]/g, '')).filter(Boolean);
  const compact = words.join(' ');
  if (!compact || compact.length < 3) return '';
  if (words.length > 6) return '';
  if (words.length === 1 && STOP_WORDS.has(compact)) return '';
  return compact;
}

function extractCandidateWords(value) {
  const source = String(value || '').toLowerCase();
  const tokens = source
    .replace(/['"`]/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const phrases = new Set();
  for (let size = 1; size <= Math.min(5, tokens.length); size += 1) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const phrase = tokens.slice(index, index + size).join(' ');
      const candidate = sanitizeCandidate(phrase);
      if (candidate) phrases.add(candidate);
    }
  }
  return [...phrases];
}

function appendBadWordCandidate(value, opts = {}) {
  const queuePath = opts.queuePath || DEFAULT_QUEUE_PATH;
  const candidate = sanitizeCandidate(value);
  if (!candidate) return false;
  ensureFile(queuePath);
  const existing = readLines(queuePath);
  if (existing.includes(candidate)) return false;
  const existingText = fs.readFileSync(queuePath, 'utf8');
  const prefix = existingText && !existingText.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(queuePath, `${prefix}${candidate}\n`, 'utf8');
  return true;
}

function appendRemovedTextForReview(value, opts = {}) {
  const queuePath = opts.queuePath || DEFAULT_QUEUE_PATH;
  const added = [];
  for (const candidate of extractCandidateWords(value)) {
    if (appendBadWordCandidate(candidate, { queuePath })) added.push(candidate);
  }
  return added;
}

function getPendingBadWordCandidates({ queuePath = DEFAULT_QUEUE_PATH, checkpointPath = DEFAULT_CHECKPOINT_PATH } = {}) {
  ensureFile(queuePath);
  if (checkpointPath && fs.existsSync(checkpointPath)) {
    const checkpointText = (fs.readFileSync(checkpointPath, 'utf8') || '').trim();
    const checkpoint = Number.parseInt(checkpointText, 10);
    if (Number.isFinite(checkpoint) && checkpoint >= 0) {
      const queue = readLines(queuePath);
      return queue.slice(Math.min(checkpoint, queue.length));
    }
  }
  return readLines(queuePath);
}

function parseAiWordList(text) {
  const source = String(text || '').trim();
  if (!source) return [];

  const cleaned = source
    .replace(/```(?:json|txt)?/gi, ' ')
    .replace(/```/g, ' ')
    .replace(/^(?:approved|keep|final|output|entries?|words?|phrases?)\s*:?\s*/i, '')
    .replace(/^[\-\*\d.\)]\s*/gm, '')
    .replace(/^\s*[-*]\s*/gm, '')
    .replace(/^\s*"|"\s*$/g, '')
    .replace(/^\s*'|'\s*$/g, '');

  const entries = cleaned
    .split(/\r?\n/)
    .flatMap((line) => line.split(/\s*[,;]\s*/))
    .map((entry) => String(entry || '').trim().toLowerCase())
    .map((entry) => entry.replace(/^[-*\d.\)\s]+/, '').replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
    .filter((entry) => {
      if (!entry || entry.startsWith('json')) return false;
      if (/^(approved|final|output|keep|remove|rejected|entries?|words?|phrases?)\b/i.test(entry)) return false;
      return true;
    })
    .map((entry) => sanitizeCandidate(entry))
    .filter(Boolean);

  if (entries.length) return [...new Set(entries)];

  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return [...new Set(parsed.map((entry) => sanitizeCandidate(entry)).filter(Boolean))];
    if (parsed && Array.isArray(parsed.words)) return [...new Set(parsed.words.map((entry) => sanitizeCandidate(entry)).filter(Boolean))];
  } catch {
    // ignore invalid JSON and fall back to plain text parsing
  }

  return [...new Set(source
    .split(/[\s,;\n]+/)
    .map((word) => sanitizeCandidate(word))
    .filter(Boolean))];
}

function defaultAiModInstructions() {
  return [
    'You are filtering a moderation wordlist for a student collaboration app.',
    'Return ONLY the final approved entries, one per line, in lowercase.',
    'No markdown, no bullets, no numbering, no code fences, no headers, no explanations, no quotes, no commas, no extra text.',
    'Example format:',
    'stupid',
    'i will kill you',
    'bitch',
    'A term can be harmful as a phrase even if the individual words are not inherently bad.',
    'Discard neutral or context-only words and phrases such as doofus, bully, awkward, weird, noisy, or hate when used normally.',
    'Keep only genuinely profane, abusive, threatening, or hateful words and phrases.',
    'Do not output any sentence fragments like "approved entries" or "- " or "Here are the results".'
  ].join('\n');
}

async function reviewQueuedBadWords({
  queuePath = DEFAULT_QUEUE_PATH,
  checkpointPath = DEFAULT_CHECKPOINT_PATH,
  badWordsPath = DEFAULT_USER_BAD_WORDS_PATH,
  discardPath = DEFAULT_DISCARD_PATH,
  instructionsPath = DEFAULT_INSTRUCTIONS_PATH,
  apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  batchSize = Number(process.env.BAD_WORD_REVIEW_BATCH_SIZE || '25')
} = {}) {
  ensureFile(queuePath);
  ensureFile(badWordsPath);
  ensureFile(discardPath);
  ensureFile(instructionsPath);

  const queue = readLines(queuePath);
  const pending = queue.slice(0, Math.max(1, Number.isFinite(batchSize) ? batchSize : 25));

  if (!pending.length) return { checked: 0, kept: [], removed: [], total: queue.length };

  if (!apiKey || typeof fetchImpl !== 'function') {
    const discarded = pending.slice();
    for (const entry of discarded) appendUniqueLine(discardPath, entry);
    writeQueueFile(queuePath, queue.slice(pending.length));
    return { checked: pending.length, kept: [], removed: discarded, total: queue.length, fallback: 'missing-openrouter-key' };
  }

  const instructions = fs.readFileSync(instructionsPath, 'utf8').trim() || defaultAiModInstructions();
  const strictPrompt = [
    'OUTPUT FORMAT RULES:',
    '1. Return only the approved words and phrases, one per line.',
    '2. Use lowercase only.',
    '3. No markdown, no headings, no bullets, no numbering, no code fences, no commas, no explanation, no quotes.',
    '4. Each line must be an exact entry only.',
    '5. If a phrase is harmful, keep the full phrase as written, for example: i will kill you',
    '6. If an item is neutral or context-only, do not include it.',
    '7. Do not add any text before or after the list.',
    '8. Blank lines are not allowed.',
    '',
    'Candidates to review:',
    pending.join('\n')
  ].join('\n');

  const messages = [
    { role: 'system', content: instructions },
    { role: 'user', content: strictPrompt }
  ];

  let response;
  try {
    response = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
        'X-Title': 'StudyHub moderation queue'
      },
      body: JSON.stringify({ model, temperature: 0, messages })
    });
  } catch {
    const discarded = pending.slice();
    for (const entry of discarded) appendUniqueLine(discardPath, entry);
    writeQueueFile(queuePath, queue.slice(pending.length));
    return { checked: pending.length, kept: [], removed: discarded, total: queue.length, fallback: 'openrouter-fetch-failed' };
  }

  if (!response.ok) {
    const discarded = pending.slice();
    for (const entry of discarded) appendUniqueLine(discardPath, entry);
    writeQueueFile(queuePath, queue.slice(pending.length));
    return { checked: pending.length, kept: [], removed: discarded, total: queue.length, fallback: `openrouter-status-${response.status || 'unknown'}` };
  }

  let decision;
  try {
    decision = await response.json();
  } catch {
    const discarded = pending.slice();
    for (const entry of discarded) appendUniqueLine(discardPath, entry);
    writeQueueFile(queuePath, queue.slice(pending.length));
    return { checked: pending.length, kept: [], removed: discarded, total: queue.length, fallback: 'openrouter-json-failed' };
  }

  const aiReply = decision?.choices?.[0]?.message?.content || '';
  const allowed = parseAiWordList(aiReply);
  const allowedSet = new Set(allowed);
  const kept = [];
  const existing = readLines(badWordsPath);
  const existingSet = new Set(existing);

  for (const word of allowed) {
    if (!word || existingSet.has(word)) continue;
    appendUniqueLine(badWordsPath, word);
    existingSet.add(word);
    kept.push(word);
  }

  const removed = pending.filter((word) => !allowedSet.has(word));
  for (const word of removed) appendUniqueLine(discardPath, word);
  writeQueueFile(queuePath, queue.slice(pending.length));

  return {
    checked: pending.length,
    kept,
    removed,
    total: queue.length
  };
}

module.exports = {
  DEFAULT_BAD_WORDS_PATH: DEFAULT_USER_BAD_WORDS_PATH,
  DEFAULT_CHECKPOINT_PATH,
  DEFAULT_DISCARD_PATH,
  DEFAULT_INSTRUCTIONS_PATH,
  DEFAULT_MODEL,
  DEFAULT_PRESET_BAD_WORDS_PATH,
  DEFAULT_QUEUE_PATH,
  DEFAULT_USER_BAD_WORDS_PATH,
  OPENROUTER_URL,
  appendBadWordCandidate,
  appendRemovedTextForReview,
  defaultAiModInstructions,
  extractCandidateWords,
  getPendingBadWordCandidates,
  parseAiWordList,
  readLines,
  reviewQueuedBadWords,
  sanitizeCandidate
};
