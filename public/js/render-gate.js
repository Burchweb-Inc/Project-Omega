(() => {
  const form = document.querySelector('[data-render-gate-launch]');
  if (!form) return;

  const button = form.querySelector('button[type="submit"]');
  const status = document.querySelector('[data-render-gate-status]');

  function announce(message) {
    if (status) status.textContent = message;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const renderWindow = window.open('about:blank', '_blank');
    if (!renderWindow) {
      announce('Allow pop-ups for this site to open the 3D Render Test in a new tab.');
      return;
    }

    renderWindow.opener = null;
    renderWindow.document.title = 'Opening 3D Render Test';
    renderWindow.document.body.textContent = 'Loading 3D Render Test...';
    button.disabled = true;
    announce('Opening the 3D Render Test in a new tab...');

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin',
        headers: { Accept: 'text/html' }
      });

      if (response.redirected) {
        renderWindow.close();
        window.location.assign(response.url);
        return;
      }
      if (!response.ok || !response.body) throw new Error(`Unexpected render response: ${response.status}`);

      const targetDocument = renderWindow.document;
      targetDocument.open();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const baseTag = `<base href="${response.url.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`;
      let head = '';
      let wroteBase = false;

      while (true) {
        const { value, done } = await reader.read();
        const chunk = decoder.decode(value || new Uint8Array(), { stream: !done });
        if (!wroteBase) {
          head += chunk;
          const match = /<head\b[^>]*>/i.exec(head);
          if (match) {
            const insertAt = match.index + match[0].length;
            targetDocument.write(`${head.slice(0, insertAt)}${baseTag}${head.slice(insertAt)}`);
            head = '';
            wroteBase = true;
          } else if (head.length > 65536) {
            throw new Error('The render document has no head element.');
          }
        } else if (chunk) {
          targetDocument.write(chunk);
        }
        if (done) break;
      }

      if (!wroteBase) throw new Error('The render document has no head element.');
      targetDocument.close();
      window.location.assign('/dashboard');
    } catch (error) {
      renderWindow.close();
      button.disabled = false;
      announce('The 3D Render Test could not be opened. Please try again.');
      console.error('[3D render gate] Failed to open the render test.', error);
    }
  });
})();
