/**
 * Persistence for bad-word review logs. The trigger identifies what initiated
 * the review, checked is the number of words examined, keptWords and
 * removedWords are JSON-serialized word lists, and fallback records an
 * error/fallback reason when automated review could not complete normally.
 * createdAt is the timestamp assigned by the caller for this review event.
 */
module.exports = (db) => ({
  init: () =>
    db.exec(`CREATE TABLE IF NOT EXISTS bad_word_review_logs (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL,
        checked INTEGER NOT NULL,
        kept_words TEXT NOT NULL DEFAULT '[]',
        removed_words TEXT NOT NULL DEFAULT '[]',
        fallback TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`),
  /**
   * Adds a review log.
   * @param {object} values
   * @param {string} values.id Stable unique ID for this log entry.
   * @param {string} values.trigger Review source, such as `manual` or `scheduled`.
   * @param {number} values.checked Number of words checked during the review.
   * @param {string} values.keptWords JSON-serialized list of retained words.
   * @param {string} values.removedWords JSON-serialized list of removed words.
   * @param {string} values.fallback Fallback/error reason, or an empty string.
   * @param {string} values.createdAt Timestamp for when the review occurred.
   * @returns {import('better-sqlite3').RunResult}
   */
  add: ({ id, trigger, checked, keptWords, removedWords, fallback, createdAt }) =>
    db.prepare(`INSERT INTO bad_word_review_logs
      (id, trigger, checked, kept_words, removed_words, fallback, created_at)
      VALUES (@id, @trigger, @checked, @keptWords, @removedWords, @fallback, @createdAt)`)
      .run({ id, trigger, checked, keptWords, removedWords, fallback, createdAt }),
  cleanup: () => db.prepare(`DELETE FROM bad_word_review_logs
    WHERE id NOT IN (
      SELECT id FROM bad_word_review_logs
      ORDER BY created_at DESC LIMIT 10
    )`).run(),
});
