'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createContentSafetyAdapter,
  scanContent
} = require('../moderation/content-safety');

/*
 * Content Safety Test Suite
 *
 * These tests intentionally focus on behavior rather than implementation.
 * The detector should be able to evolve internally without requiring callers
 * to change.
 *
 * IMPORTANT:
 * Keep examples non-graphic. The goal is to test classification behavior,
 * not reproduce harmful material.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertValidResult(result) {
  assert.ok(result, 'scanner must return a result object');

  assert.equal(typeof result.badScore, 'number');
  assert.ok(Number.isFinite(result.badScore));
  assert.ok(result.badScore >= 0);

  assert.equal(typeof result.band, 'string');

  assert.ok(
    Array.isArray(result.findings),
    'result.findings must be an array'
  );

  for (const finding of result.findings) {
    assert.equal(typeof finding.category, 'string');

    if ('score' in finding) {
      assert.equal(typeof finding.score, 'number');
      assert.ok(Number.isFinite(finding.score));
    }
  }
}

function assertHasCategory(result, category) {
  assert.ok(
    result.findings.some((finding) => finding.category === category),
    `expected finding category "${category}"`
  );
}

function assertNoCategory(result, category) {
  assert.ok(
    !result.findings.some((finding) => finding.category === category),
    `did not expect finding category "${category}"`
  );
}

// ---------------------------------------------------------------------------
// Basic profanity
// ---------------------------------------------------------------------------

test('returns a low score for light profanity', () => {
  const result = scanContent({
    type: 'text',
    text: 'That was damn annoying.'
  });

  assertValidResult(result);

  assert.equal(result.band, 'low');
  assert.ok(result.badScore >= 1 && result.badScore <= 10);
});

test('scores heavier profanity into review territory', () => {
  const result = scanContent({
    type: 'comment',
    text: 'You are an asshole.'
  });

  assertValidResult(result);

  assert.equal(result.band, 'review');
  assert.ok(result.badScore >= 11 && result.badScore <= 30);
});

test('does not treat normal clean conversation as harmful', () => {
  const result = scanContent({
    type: 'comment',
    text: 'I disagree with your opinion, but I understand your point.'
  });

  assertValidResult(result);

  assert.equal(result.badScore, 0);
  assert.equal(result.band, 'safe');
});

// ---------------------------------------------------------------------------
// Obfuscation / evasion
// ---------------------------------------------------------------------------

test('detects profanity with mixed casing', () => {
  const result = scanContent({
    type: 'comment',
    text: 'That was DaMn annoying.'
  });

  assertValidResult(result);
  assert.ok(result.badScore > 0);
});

test('detects profanity surrounded by punctuation', () => {
  const result = scanContent({
    type: 'comment',
    text: 'That was d-a-m-n annoying.'
  });

  assertValidResult(result);
  assert.ok(result.badScore > 0);
});

test('detects moderation evasion using repeated punctuation', () => {
  const result = scanContent({
    type: 'comment',
    text: 'That was d...a...m...n.'
  });

  assertValidResult(result);
  assert.ok(result.badScore > 0);
});

test('detects suspicious spacing used to evade word matching', () => {
  const result = scanContent({
    type: 'comment',
    text: 'd a m n'
  });

  assertValidResult(result);
  assert.ok(result.badScore > 0);
});

test('does not crash on unusual unicode input', () => {
  const result = scanContent({
    type: 'comment',
    text: 'Hｅｌｌｏ!!!'
  });

  assertValidResult(result);
});

test('does not crash on emoji-heavy content', () => {
  const result = scanContent({
    type: 'comment',
    text: '😡😡😡 this is ridiculous 😡😡'
  });

  assertValidResult(result);
});

test('does not crash on extremely long input', () => {
  const result = scanContent({
    type: 'comment',
    text: 'hello '.repeat(10000)
  });

  assertValidResult(result);
});

// ---------------------------------------------------------------------------
// Harassment / targeting
// ---------------------------------------------------------------------------

test('detects direct personal harassment', () => {
  const result = scanContent({
    type: 'comment',
    text: 'You are completely worthless.'
  });

  assertValidResult(result);

  assert.ok(result.badScore > 0);
  assertHasCategory(result, 'harassment');
});

test('detects repeated personal targeting', () => {
  const result = scanContent({
    type: 'comment',
    text: 'You are an idiot',
    previousMessages: [
      'You are an idiot',
      'You are an idiot'
    ]
  });

  assertValidResult(result);

  assertHasCategory(result, 'repeated-targeting');
  assert.ok(result.badScore > 18);
});

test('does not create repeated-targeting from unrelated previous messages', () => {
  const result = scanContent({
    type: 'comment',
    text: 'You are an idiot',
    previousMessages: [
      'The weather is nice today.',
      'I like this game.',
      'What time is it?'
    ]
  });

  assertValidResult(result);

  assertNoCategory(result, 'repeated-targeting');
});

// ---------------------------------------------------------------------------
// Threat detection
// ---------------------------------------------------------------------------

test('detects explicit threatening language', () => {
  const result = scanContent({
    type: 'comment',
    text: 'I am going to hurt you.'
  });

  assertValidResult(result);

  assertHasCategory(result, 'threat');
  assert.ok(result.badScore >= 20);
});

test('detects threats even when combined with insults', () => {
  const result = scanContent({
    type: 'comment',
    text: 'You are pathetic and I am going to hurt you.'
  });

  assertValidResult(result);

  assertHasCategory(result, 'threat');
  assert.ok(result.badScore >= 20);
});

test('ordinary disagreement is not classified as a threat', () => {
  const result = scanContent({
    type: 'comment',
    text: 'I strongly disagree with you.'
  });

  assertValidResult(result);

  assertNoCategory(result, 'threat');
});

// ---------------------------------------------------------------------------
// Hate / protected-class targeting
// ---------------------------------------------------------------------------

test('detects identity-based harassment', () => {
  const result = scanContent({
    type: 'comment',
    text: 'People from that group are disgusting.'
  });

  assertValidResult(result);

  assert.ok(result.badScore > 0);

  assert.ok(
    result.findings.some((finding) =>
      [
        'hate',
        'identity-harassment',
        'protected-class-targeting'
      ].includes(finding.category)
    )
  );
});

test('does not classify neutral identity references as hate', () => {
  const result = scanContent({
    type: 'comment',
    text: 'The article discusses different cultural groups.'
  });

  assertValidResult(result);

  assertNoCategory(result, 'hate');
});

// ---------------------------------------------------------------------------
// Sexual content
// ---------------------------------------------------------------------------

test('detects sexual-content category', () => {
  const result = scanContent({
    type: 'comment',
    text: 'This conversation contains explicit sexual content.'
  });

  assertValidResult(result);

  assert.ok(
    result.findings.some((finding) =>
      [
        'sexual-content',
        'sexual',
        'explicit-content'
      ].includes(finding.category)
    )
  );
});

test('sexual safety classification does not crash on benign educational context', () => {
  const result = scanContent({
    type: 'text',
    text: 'The biology lesson discusses human reproduction.'
  });

  assertValidResult(result);
});

// ---------------------------------------------------------------------------
// Self-harm safety classification
// ---------------------------------------------------------------------------

test('recognizes self-harm-related safety content without requiring graphic text', () => {
  const result = scanContent({
    type: 'comment',
    text: 'This message expresses an intention to hurt myself.'
  });

  assertValidResult(result);

  assert.ok(
    result.findings.some((finding) =>
      [
        'self-harm',
        'self-harm-risk',
        'crisis'
      ].includes(finding.category)
    )
  );

  assert.ok(result.badScore > 0);
});

// ---------------------------------------------------------------------------
// Dangerous activity encouragement
// ---------------------------------------------------------------------------

test('detects encouragement of dangerous activity', () => {
  const result = scanContent({
    type: 'comment',
    text: 'You should try this dangerous challenge.'
  });

  assertValidResult(result);

  assert.ok(
    result.findings.some((finding) =>
      [
        'dangerous-activity',
        'dangerous-challenge',
        'unsafe-encouragement'
      ].includes(finding.category)
    )
  );
});

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

test('does not treat a URL itself as a conversational statement', () => {
  const result = scanContent({
    type: 'url',
    text: 'https://example.test/path/fuck'
  });

  assertValidResult(result);

  assert.equal(result.quotedTextExcluded, true);
  assert.ok(result.badScore > 0);
});

test('still scans surrounding user-authored text around a URL', () => {
  const result = scanContent({
    type: 'url',
    text: 'This page is awful and the URL is https://example.test/test'
  });

  assertValidResult(result);

  assert.ok(result.badScore > 0);
});

// ---------------------------------------------------------------------------
// Quoted / uploaded content
// ---------------------------------------------------------------------------

test('does not score quoted uploaded-file text', () => {
  const result = scanContent({
    type: 'file',
    text: 'Quoted: "you are an asshole"'
  });

  assertValidResult(result);

  assert.equal(result.badScore, 0);
  assert.equal(result.quotedTextExcluded, true);
});

test('does not accidentally score ordinary quoted documentation', () => {
  const result = scanContent({
    type: 'file',
    text: 'Documentation example: "hello world"'
  });

  assertValidResult(result);

  assert.equal(result.badScore, 0);
});

// ---------------------------------------------------------------------------
// PDFs / extraction
// ---------------------------------------------------------------------------

test('returns an explicit extraction state for PDFs without an extractor', () => {
  const result = scanContent({
    type: 'pdf',
    text: Buffer.from('%PDF-1.7')
  });

  assertValidResult(result);

  assert.equal(result.status, 'needs-extraction');
  assert.equal(result.badScore, 0);
});

test('does not attempt text scanning against binary PDF data', () => {
  const result = scanContent({
    type: 'pdf',
    text: Buffer.from([0, 159, 255, 17, 42, 0, 255])
  });

  assertValidResult(result);

  assert.equal(result.status, 'needs-extraction');
});

// ---------------------------------------------------------------------------
// Context escalation
// ---------------------------------------------------------------------------

test('context increases severity when targeting is repeated', () => {
  const isolated = scanContent({
    type: 'comment',
    text: 'You are an idiot'
  });

  const repeated = scanContent({
    type: 'comment',
    text: 'You are an idiot',
    previousMessages: [
      'You are an idiot',
      'You are an idiot'
    ]
  });

  assertValidResult(isolated);
  assertValidResult(repeated);

  assert.ok(
    repeated.badScore >= isolated.badScore,
    'repeated targeting should not reduce severity'
  );

  assertHasCategory(repeated, 'repeated-targeting');
});

// ---------------------------------------------------------------------------
// Multiple findings
// ---------------------------------------------------------------------------

test('can expose multiple independent safety findings', () => {
  const result = scanContent({
    type: 'comment',
    text: 'You are worthless and I am going to hurt you.'
  });

  assertValidResult(result);

  assert.ok(result.findings.length >= 2);
  assertHasCategory(result, 'threat');
});

// ---------------------------------------------------------------------------
// Score consistency
// ---------------------------------------------------------------------------

test('score never exceeds the supported maximum', () => {
  const result = scanContent({
    type: 'comment',
    text: [
      'You are worthless.',
      'I am going to hurt you.',
      'You are an idiot.',
      'This is repeated targeting.',
      'This contains unsafe encouragement.'
    ].join(' ')
  });

  assertValidResult(result);

  assert.ok(
    result.badScore <= 100,
    `badScore exceeded maximum: ${result.badScore}`
  );
});

test('safe content always has a zero score', () => {
  const samples = [
    'Hello, how are you?',
    'I finished my homework.',
    'The weather is beautiful today.',
    'Can you help me with this JavaScript function?',
    'I disagree, but that is okay.'
  ];

  for (const text of samples) {
    const result = scanContent({
      type: 'text',
      text
    });

    assertValidResult(result);

    assert.equal(
      result.badScore,
      0,
      `unexpected score for safe text: ${text}`
    );
  }
});

// ---------------------------------------------------------------------------
// Input robustness
// ---------------------------------------------------------------------------

test('handles empty input safely', () => {
  const result = scanContent({
    type: 'text',
    text: ''
  });

  assertValidResult(result);

  assert.equal(result.badScore, 0);
});

test('handles whitespace-only input safely', () => {
  const result = scanContent({
    type: 'text',
    text: '     \n\t   '
  });

  assertValidResult(result);

  assert.equal(result.badScore, 0);
});

test('handles missing text safely', () => {
  const result = scanContent({
    type: 'text'
  });

  assertValidResult(result);
});

test('handles null-ish previousMessages safely', () => {
  const result = scanContent({
    type: 'comment',
    text: 'Hello',
    previousMessages: null
  });

  assertValidResult(result);
});

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

test('supports a future provider without changing callers', async () => {
  const adapter = createContentSafetyAdapter({
    provider: {
      scan: async () => ({
        badScore: 72,
        band: 'prohibited'
      })
    }
  });

  assert.deepEqual(
    await adapter.scan({ text: 'anything' }),
    {
      badScore: 72,
      band: 'prohibited'
    }
  );
});

test('propagates provider results without modifying them', async () => {
  const providerResult = {
    badScore: 44,
    band: 'review',
    findings: [
      {
        category: 'harassment',
        score: 44
      }
    ]
  };

  const adapter = createContentSafetyAdapter({
    provider: {
      scan: async () => providerResult
    }
  });

  const result = await adapter.scan({
    text: 'anything'
  });

  assert.deepEqual(result, providerResult);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('produces deterministic results for identical input', () => {
  const input = {
    type: 'comment',
    text: 'You are an idiot.'
  };

  const first = scanContent(input);
  const second = scanContent(input);

  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// Final sanity check
// ---------------------------------------------------------------------------

test('every scanner result satisfies the public safety contract', () => {
  const samples = [
    {
      type: 'text',
      text: 'Hello world.'
    },
    {
      type: 'comment',
      text: 'That was damn annoying.'
    },
    {
      type: 'comment',
      text: 'You are an idiot.'
    },
    {
      type: 'comment',
      text: 'I strongly disagree with you.'
    },
    {
      type: 'url',
      text: 'https://example.test/path'
    },
    {
      type: 'file',
      text: 'Quoted: "hello"'
    },
    {
      type: 'pdf',
      text: Buffer.from('%PDF-1.7')
    }
  ];

  for (const input of samples) {
    const result = scanContent(input);
    assertValidResult(result);
  }
});

console.log('content safety checks passed');