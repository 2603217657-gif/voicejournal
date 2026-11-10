/* A self-contained companion: no chat data, network requests or audio. */
(() => {
  const root = document.createElement('aside');
  root.className = 'cat-companion';
  root.setAttribute('aria-label', '猫猫陪伴');
  root.innerHTML = `
    <button class="yarn-toggle" type="button" aria-label="打开猫猫陪伴" aria-expanded="false" aria-controls="cat-companion-panel">
      <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="23" cy="23" r="14"/><path d="M12 14c9 0 19 8 22 17M9 22c9-1 17 5 21 13M13 32c3-9 10-16 19-18M18 36c3-9 10-15 18-16M13 13c-1 9 7 17 17 19M35 30c7 3 7 10 1 11-4 1-6-2-3-4"/></svg>
      <span class="yarn-label">摸摸猫</span>
    </button>
    <section id="cat-companion-panel" class="cat-panel" hidden aria-label="猫猫互动">
      <button class="cat-close" type="button" aria-label="收起猫猫">×</button>
      <p class="cat-message" role="status" aria-live="polite">不着急，先摸摸我。</p>
      <button class="cat-touch" type="button" aria-label="抚摸猫猫，可点击或按住轻轻移动">
        <span class="cat-ground"></span>
        <span class="cat-picture"><img src="assets/cat.png" alt="抬头等你摸摸的小猫" draggable="false"></span>
        <svg class="cat-hand" viewBox="0 0 100 80" aria-hidden="true"><path d="M88 21 72 18 50 5c-7-4-12 3-6 8l8 7-23-8c-8-3-11 5-4 9l20 9-26-5c-8-1-10 7-2 10l26 7-20 1c-8 0-8 9 0 10l25 2c-7 7-4 15 3 12l20-10c7-4 10-10 14-15l10 1"/></svg>
        <span class="cat-hearts" aria-hidden="true"><i>♡</i><i>♡</i><i>♡</i></span>
      </button>
      <p class="cat-hint">点一点，或按住轻轻摸摸</p>
    </section>`;
  document.body.append(root);
  const toggle = root.querySelector('.yarn-toggle');
  const panel = root.querySelector('.cat-panel');
  const touch = root.querySelector('.cat-touch');
  const message = root.querySelector('.cat-message');
  let timer, held = false, last = 0, count = 0;
  const messages = ['呼噜呼噜……', '嗯，再摸一下嘛。', '今天辛苦啦，我陪你。', '喵～你的手好温柔。'];
  function stop() { held = false; clearTimeout(timer); root.classList.remove('is-petting'); }
  function pet() {
    if (panel.hidden) return;
    root.classList.add('is-petting');
    if (Date.now() - last > 1300) { message.textContent = messages[count++ % messages.length]; last = Date.now(); }
    clearTimeout(timer);
    timer = setTimeout(() => { if (!held) root.classList.remove('is-petting'); }, 1300);
  }
  function close() {
    stop(); panel.hidden = true; toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'false'); toggle.focus();
  }
  toggle.addEventListener('click', () => {
    toggle.hidden = true; panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true'); touch.focus();
  });
  root.querySelector('.cat-close').addEventListener('click', close);
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); close(); } });
  touch.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    held = true; touch.setPointerCapture(e.pointerId); pet();
  });
  touch.addEventListener('pointermove', e => {
    if (!held) return;
    const rect = touch.getBoundingClientRect();
    const offset = Math.max(-22, Math.min(22, (e.clientX - rect.left - rect.width / 2) * .3));
    touch.style.setProperty('--pet-x', `${offset}px`); pet();
  });
  touch.addEventListener('pointerup', () => { held = false; pet(); });
  touch.addEventListener('pointercancel', stop);
  touch.addEventListener('lostpointercapture', () => { if (held) stop(); });
  touch.addEventListener('click', pet);
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
