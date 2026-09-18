const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const index = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const courseView = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'course.ejs'), 'utf8');
const todoView = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'todo.ejs'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.ok(pkg.dependencies['better-sqlite3'], 'Better SQLite should be installed for secure persistent storage.');
assert.match(index, /<script src="\/app\.js"><\/script>/, 'The page should load the client-side auth tab script.');
assert.match(courseView, /inline-create-form.*hidden/, 'The inline event form should stay hidden until the Create event action is triggered.');
assert.match(todoView, /data-live-todo-form/, 'The personal todo add form should be wired for browser-side updates.');
assert.match(todoView, /toggle-task-form/, 'The personal todo should support browser-side add/toggle updates without a full page refresh.');
assert.match(app, /items\/reorder/, 'Course tasks should have a reorder endpoint.');
assert.match(client, /course:items-reordered/, 'Course task reordering should update live over websockets.');

console.log('smoke checks passed');
