(() => {
  const pageKeys = [
    'dashboard', 'calendar', 'todo', 'settings', 'account-settings', 'site-admin',
    'org', 'course', 'admin', 'people', 'breakout', 'breakout-groups', 'new-item',
    'new-course', 'people-new', 'lockui'
  ];
  const bodyPageKey = pageKeys.find((page) => document.body.classList.contains(page));
  const pageKey = new URLSearchParams(window.location.search).get('tab') === 'groups'
    ? 'groups'
    : bodyPageKey === 'account-settings' ? 'settings' : bodyPageKey || 'dashboard';

  function annotateTree(root = document.body) {
    root.querySelectorAll('*').forEach((element) => {
      const path = [];
      let node = element;
      while (node && node !== document.body) {
        const parent = node.parentElement;
        if (!parent) return;
        path.unshift([...parent.children].indexOf(node));
        node = parent;
      }
      if (node === document.body && path.length <= 16) {
        element.dataset.themeNode = `${pageKey}-${path.join('-')}`;
      }
    });
  }

  annotateTree();
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      annotateTree();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
