'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Filter } = require('content-checker');
const { BAD_WORDS, scanContent } = require('./content-safety');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-3.5-content-safety:free';
const DEFAULT_URL_SOURCE = 'https://raw.githubusercontent.com/EBazarov/nsfw_data_source_urls/master/raw_data/age_college/reddit_sub_collegensfw/urls.txt';
const contentChecker = new Filter({ emptyList: true });
contentChecker.addWords(...BAD_WORDS);

function readUrlList(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Set();
  return new Set(fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map((url) => url.trim()).filter(Boolean));
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(url).trim().toLowerCase().replace(/\/$/, '');
  }
}

function parseDecision(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('OpenRouter returned no moderation decision.');
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('OpenRouter returned non-JSON moderation output.');
  const decision = JSON.parse(json);
  return { flagged: Boolean(decision.flagged), uncertain: Boolean(decision.uncertain), reasoning: String(decision.reasoning || '') };
}

function resultFromLocal(local, reason, fallback = false) {
  return {
    ...local,
    ...(reason ? { findings: [...local.findings, { category: 'ai-moderation', points: 100, matches: 1, source: 'openrouter', reasoning: reason }] } : {}),
    ...(reason ? { badScore: 100, band: 'prohibited' } : {}),
    ...(fallback ? { provider: 'strict-regex-fallback' } : {})
  };
}

function strictFallback(input) {
  const local = scanContent(input);
  const hasListMatch = local.findings.some((finding) => finding.category === 'bad-word-list');
  if (!hasListMatch) return local;
  return { ...local, badScore: Math.max(20, local.badScore), band: local.badScore >= 31 ? local.band : 'review' };
}

function contentCheckerResult(local) {
  return { ...local, badScore: Math.max(20, local.badScore), band: local.band === 'safe' ? 'review' : local.band, findings: [...local.findings, { category: 'content-checker', points: 20, matches: 1, source: 'content-checker' }] };
}

function createIffyModerator({ apiKey = process.env.OPENROUTER_API_KEY, model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL, fetchImpl = globalThis.fetch, urlListPath = process.env.NSFW_URL_LIST_PATH || path.join(__dirname, 'nsfw-urls.txt'), urlSourceUrl = process.env.NSFW_URL_SOURCE_URL || DEFAULT_URL_SOURCE } = {}) {
  const knownUrls = readUrlList(urlListPath);
  let remoteUrlsPromise;

  async function remoteUrls() {
    if (!urlSourceUrl || typeof fetchImpl !== 'function') return new Set();
    remoteUrlsPromise ||= fetchImpl(urlSourceUrl).then((response) => response.ok ? response.text() : '').then((text) => new Set(text.split(/\r?\n/).map(normalizeUrl).filter(Boolean))).catch(() => new Set());
    return remoteUrlsPromise;
  }

  async function scan(input = {}) {
    const local = scanContent(input);
    const checkerFlagged = contentChecker.isProfane(String(input.text || ''));
    const urls = local.urls.map(normalizeUrl);
    const corpus = new Set([...knownUrls].map(normalizeUrl));
    if (urls.some((url) => corpus.has(url) || (urlSourceUrl && url === normalizeUrl(urlSourceUrl)))) return resultFromLocal(local, 'The submitted URL appears in the NSFW source corpus.');
    if (urls.length) {
      const remote = await remoteUrls();
      if (urls.some((url) => remote.has(url))) return resultFromLocal(local, 'The submitted URL appears in the NSFW source corpus.');
    }
    if (!apiKey || typeof fetchImpl !== 'function') return checkerFlagged ? contentCheckerResult(local) : local;

    const messages = [
      { role: 'system', content: 'You are Iffy, a strict content moderation reviewer for a student collaboration app. Decide whether content is appropriate for students. Flag harassment, hate, threats, self-harm encouragement, explicit sexual content, dangerous wrongdoing, or sexual/NSFW links. Return JSON only: {"flagged": boolean, "uncertain": boolean, "reasoning": string}.' },
      { role: 'user', content: JSON.stringify({ type: input.type || 'text', content: String(input.text || ''), previousMessages: input.previousMessages || [] }) }
    ];
    let response;
    try {
      response = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000', 'X-Title': 'StudyHub Iffy moderation' },
        body: JSON.stringify({ model, temperature: 0, messages })
      });
    } catch {
      return resultFromLocal(strictFallback(input), null, true);
    }
    if (response.status === 429) return resultFromLocal(strictFallback(input), null, true);
    if (!response.ok) return resultFromLocal(local, null, true);
    let decision;
    try {
      decision = parseDecision(await response.json());
    } catch {
      return resultFromLocal(strictFallback(input), null, true);
    }
    if (checkerFlagged) return contentCheckerResult(local);
    if (!decision.flagged || decision.uncertain) return local;
    return resultFromLocal(local, decision.reasoning);
  }

  return { scan };
}

module.exports = { DEFAULT_MODEL, OPENROUTER_URL, createIffyModerator, normalizeUrl, parseDecision };