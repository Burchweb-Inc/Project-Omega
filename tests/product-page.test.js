const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');

test('renders the LockIn Study coming-soon page content', async () => {
  const html = await ejs.renderFile('views/partials/lockin-study-pre.ejs');

  assert.match(html, /<h1 id="product-title">LockIn Study<\/h1>/);
  assert.match(html, /src="\/media\/li-study-coming-soon\.png"/);
  assert.match(html, /alt="Preview of a LockIn Study quiz interface"/);
  assert.match(html, /LockIn Study is the solution/);
  assert.ok(html.indexOf('<h1 id="product-title">') < html.indexOf('<img'));
  assert.ok(html.indexOf('<img') < html.indexOf('<div class="product-description">'));
});
