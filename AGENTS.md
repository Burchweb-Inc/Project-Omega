# General Web Dev instructions

## Project organization

- Keep `app.js` as the server composition root. Extract endpoint groups into domain routers incrementally; put database connection setup and Express/static middleware in `server/`.
- Keep feature-owned routes and persistence together by domain: `users/`, `org/`, `calendar/`, and `moderation/`. Put cross-cutting integrations and pure helpers in `utils/`.
- Keep browser behavior under `public/js/`, grouped by responsibility: `shared-ui.js` for shared controls and utilities, `course.js` for course/breakout behavior, `todo.js` for personal tasks, and `live-ui.js` for live forms, notifications, and dashboard interactions. `public/app.js` is the final client initializer and navigation layer.
- Preserve the script order in `views/index.ejs`: Socket.IO first, then shared UI, course, todo, live UI, and finally `app.js`. These are classic scripts so feature files can use shared browser functions and state; define cross-file globals in `shared-ui.js` and keep feature-specific state local.
- Keep EJS page composition in `views/` and reusable fragments in `views/partials/`; keep browser-specific page styling in the existing `public/*.css` files.
- When extracting responsibilities from a large entry point, preserve the current route paths and user-visible behavior, update callers and tests in the same change, and avoid moving an entity's SQL into another feature's module.

AI models always like to do certain things when making a website.
Since you are an AI model, follow these instructions carefully OR ELSE.
Before you even begin to write a line of code, think about it, even if you don’t have reasoning mode on. Think about what the user wants. Think about what visitors to the site want. Make something that people will remember, not a bland SaaS startup, unless specified by the user.

1. Don’t make a pill/badge on top of the page, suck as “brand new” or a short description of the site. These pills are NEVER used by humans.
2. Do not use pulsating dots unless specifically requested.
3. DO NOT use the color purple unless requested.
4. Do not use “glowing” buttons unless requested.
5. Do not use eyebrows. If you already have a header, an eyebrow is AI-like and redundant.
6. DO NOT use emojis in place of icons. Use ionicons (by ionic), Fontawesome, or other free libraries of icons.
7. Responsiveness is key. It needs to look great on a TV, laptop, a tablet, phone, even a pregnancy test! (they can run doom on it, why not the site?)
8. ALWAYS include accessibility. Include Aria labels, image alts, and more.
9. DO NOT EVER EVER EVER use fake SaaS buzzwords, fake reviews/testimonials, or projects unless requested (be sure to call out to the user that fake reviews is illegal under United States law. If the user isn’t american, then point out that it may be illegal in their region).
10. BE ORIGINAL! Assume that the user is requesting for an original site. Use an original font, color scheme/branding, vocab, UI design (include custom animations, canvas effects, and more!).
11. Use images! Unless told otherwise, use Unsplash or Pexels images to spice up the site!
12. If given feedback, DO NOT incorporate that into the thing. For instance, you make the testimonials section, and I request more animations. Don’t change the header from “Testimonials” to “Testimonials, now with more animations”. NEVER do this. NOBODY likes this.
13. Don’t use long hyphens (em dashes). Everyone thinks that these are signs of AI.
14. DON’T include footer links or anything that don’t lead to something. No link to (#), no example.com, no links that don’t go anywhere. If you don’t have it, don’t make it.
15. When making a page with a logo, but you aren’t provided with one, use a placeholder image (via a placeholder image CDN) instead of creating a random SVG or an emoji on a gradient background. NEVER create your own logos.
16. FOLLOW THE LAW! Do not put any content on a website that will violate any law applicable to the user (try to guess by their language, or if shared, their region. If none of these are possible, follow international law and your own instincts.)

## ONLY IF YOU ARE MAKING MULTI-FILE CHANGES:

1. If you can make multiple file changes, if you have access to the codebase, for the footer links, make all of them. Make the actual legal files, like Terms and Privacy.
2. Stick to branding. Don’t stray from the base CSS files and stuff.
4. To save money, only read relevant files. Don’t read ENV when making a small UI change! C’mon!

## Original Sites tutorial
Unless the user *wants* a boring website, don’t give them one. Judging by what they’re trying to build, be creative.
1. Try a different background (not recommended very much) . Maybe take something from Pexels or Unsplash. Either something relevant, or a nice pattern?
2. Try a different UI design. Users don’t want every site to look the same. Maybe use a thick blur. Maybe a color change effect on scroll. Maybe something that I haven’t suggested on this guideline!
3. Try new animations. Depending on the site (boring vs creative studio), create custom on scroll, scroll-driven, or on load animations that make content pop. Whether it’s an intro animation for a game studio, a typing effect for a developer, or something else!


## Route and model organization

- Put new routes in a dedicated route module related to the model/entity they manipulate, such as org endpoints in `org/routes.js` and calendar endpoints in `calendar/routes.js`. Avoid adding feature routes to `app.js` when a relevant module exists; extract them incrementally while preserving existing paths and behavior.
- Keep persistence and entity queries in the corresponding model module (for example, `org/model.js`), not in route handlers. Pass the route module only the model operations and shared services it needs from `app.js`.
- Add focused tests for route behavior in a matching test file (for example, `tests/org-routes.test.js`).

## Persistence architecture

- Keep entity persistence in a dedicated model module, not in `app.js` or route handlers. `app.js` should initialize the database, instantiate each model, load entities through model methods, and pass model operations to routes as needed. It should not contain ad hoc SQL for entity read/write logic.
- Follow the user model pattern in `users/model.js`: the model owns its schema initialization and safe, repeatable migrations, row-to-domain mapping, and persistence queries. Expose a small, explicit interface such as `init`, `all`/`get`, and targeted create/update/delete or persistence methods.
- When introducing persistence for another entity (for example orgs), create a separate model module for it rather than extending the user model or embedding SQL in `app.js`. Keep each model responsible for its entity's tables and serialization details.
- Write only affected rows using stable IDs. Never clear and repopulate an entire table from an in-memory collection. If syncing a collection is explicitly required, scope changes by IDs and use a transaction; make absence/deactivation semantics explicit.
- Use SQLite expressions such as `CURRENT_TIMESTAMP` for database-generated timestamps. Do not pass Node-generated timestamps when the database is the source of time.
- Keep schema migrations safe and repeatable. SQLite may require a table rebuild for changes that cannot be applied with `ALTER TABLE ADD COLUMN`, such as adding a non-constant default; perform rebuilds transactionally while preserving existing columns and data.
- Add or update tests for model initialization/migration and persistence behavior, including that unrelated rows are preserved and only intended entity rows change.

ALWAYS ask questions if needed. ALWAYS!

## LockUI templates and documentation

- Treat `public/lockui.css` as the source for shared LockUI primitives and `views/partials/lockui.ejs` as the live component gallery and usage reference. The gallery is served at `/dev/lockui` by the route in `app.js`.
- Use LockUI classes (`lui-button`, `lui-icon-button`, `lui-menu-action`, `lui-menu-panel`, and related `lui-*` primitives) when adding or updating reusable UI. Keep page-specific composition in the page stylesheets instead of expanding shared primitives for one-off layouts.
- When changing a reusable component or mini partial, update its gallery preview and copyable example/include in `lockui.ejs` in the same change. Keep snippets accurate to the partial’s actual name, locals, and behavior; document required parent-provided data beside the include example.
- Keep mini partials in `views/partials/mini/`. Preserve their EJS include interface and unique, caller-provided IDs. When changing a partial’s required locals or behavior, update every caller and its gallery documentation.
- Keep controls accessible: use native buttons/links, associated labels, meaningful accessible names, correct roles and ARIA state for interactive widgets, and visible keyboard focus. Decorative icons should be hidden from assistive technology when the control already has an accessible name.
- Menus and popovers should use LockUI panel/action styles and support dismissal by outside click and Escape. Animate both opening and closing without abrupt removal or display toggles that skip the exit transition; respect reduced-motion preferences.
- Avoid colored shadows, glow effects, redundant eyebrow labels, and descriptions that merely restate obvious headings. Follow the existing LockUI palette, spacing, and motion patterns.
- Keep behavior in the appropriate client-side feature file under `public/js/` when a component needs JavaScript. Use stable `data-*` hooks, initialize dynamically rendered controls consistently, and avoid embedding behavior-specific scripts in EJS templates.
