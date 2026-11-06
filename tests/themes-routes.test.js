const test = require('node:test');
const assert = require('node:assert/strict');
const { cssForTheme, safeThemePayload } = require('../themes/routes');

test('theme CSS only emits allowed selectors and safe declarations', () => {
  const css = cssForTheme({
    palette: {
      background: 'linear-gradient(135deg, #123456, #ffffff)',
      text: '#fefefe',
      surface: '#ffffff',
      accent: '#123456'
    },
    wallpaper: '/media/wallpapers/wallpaper-123.webp',
    styles: {
      card: { color: '#ffffff', opacity: '0.8', transform: 'translateX(10px)' },
      'topbarButton:hover': { 'background-color': '#123456', filter: 'blur(2px)' },
      'button:active': { color: '#123456' },
      'body } body': { color: 'red' },
      'element:dashboard:0.1.3': { color: '#ffffff', 'background-color': '#123456' },
      'element:lockui:0.2.1': { color: '#ffffff' },
      'element:dashboard:0.-1': { color: 'red' },
      'element:dashboard:0.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16': { color: '#ffffff' },
      'class:lui-button.lui-button-primary': { 'background-color': '#123456', color: '#ffffff' },
      'class:lui-button.lui-button-primary:hover': { 'background-color': '#345678' },
      'class:body': { color: 'red' },
      'class:lui-button,body': { color: 'red' },
      'class:lui-button.lui-button': { color: 'red' },
      [`class:lui-${'a'.repeat(37)}`]: { color: 'red' },
      sidebar: { filter: 'blur(4px)', background: 'url(https://invalid.test/image)' }
    }
  });

  assert.match(css, /background:linear-gradient/);
  assert.match(css, /--ink:#fefefe/);
  assert.match(css, /--white:#ffffff/);
  assert.match(css, /wallpapers\/wallpaper-123\.webp/);
  assert.match(css, /\.admin-panel, \.card, \.task-card, \.report-row, \.member-card\{color:#ffffff !important;opacity:0\.8 !important\}/);
  assert.match(css, /\.sidebar\{filter:blur\(4px\) !important\}/);
  assert.match(css, /\.topbar \.lui-icon-button:hover, \.topbar \.avatar:hover, \.topbar \.notification-menu > summary:hover\{background-color:#123456 !important;filter:blur\(2px\) !important\}/);
  assert.match(css, /\[data-theme-node="dashboard-0-1-3"\]\{color:#ffffff !important;background-color:#123456 !important\}/);
  assert.match(css, /\[data-theme-node="lockui-0-2-1"\]\{color:#ffffff !important\}/);
  assert.match(css, /\.lui-button\.lui-button-primary\{background-color:#123456 !important;color:#ffffff !important\}/);
  assert.match(css, /\.lui-button\.lui-button-primary:hover\{background-color:#345678 !important\}/);
  assert.doesNotMatch(css, /:active/);
  assert.doesNotMatch(css, /transform|invalid\.test|body \}|dashboard-0--1|dashboard-0-1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16|\.body\{|lui-button,body|\.lui-button\.lui-button\{/);
});

test('theme payload rejects invalid colors and retains only visual style properties', () => {
  assert.equal(safeThemePayload({ name: 'Broken', palette: { background: 'url(https://invalid.test)' } }), null);
  const payload = safeThemePayload({
    name: 'Soft focus',
    description: 'Warm paper and quiet ink.',
    palette: { background: '#f4ead8', text: '#231f1a', surface: '#fffaf0', accent: '#7a4435' },
    styles: {
      main: { 'background-color': '#fffaf0', position: 'fixed', transform: 'scale(2)' },
      'class:lui-button.lui-button-primary': { 'background-color': '#7a4435', position: 'fixed' }
    }
  });
  assert.equal(payload.name, 'Soft focus');
  assert.deepEqual(payload.styles, {
    main: { 'background-color': '#fffaf0' },
    'class:lui-button.lui-button-primary': { 'background-color': '#7a4435' }
  });
});
