'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { reviewQueuedBadWords } = require('../moderation/bad-word-queue');

async function main() {
  const result = await reviewQueuedBadWords({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || undefined,
    batchSize: Number(process.env.BAD_WORD_REVIEW_BATCH_SIZE || '50')
  });

  console.log(JSON.stringify({
    checked: result.checked,
    checkpoint: result.checkpoint,
    total: result.total,
    kept: result.kept,
    removed: result.removed,
    fallback: result.fallback || null
  }, null, 2));
}

main().catch((error) => {
  console.error('AI bad-word review failed:', error);
  process.exit(1);
});
