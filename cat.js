(() => {
  const pets = [...(window.TREEHOLE_PETS || [])];
  try { const saved = JSON.parse(window.localStorage.getItem("treehole-custom-pet-v1")); if (saved?.frames?.length === 4 && saved.frames.every(f => typeof f === "string" && f.startsWith("data:image/png;base64,"))) pets.push(saved); } catch {}
  if (!pets.length) return;
  const root = document.createElement('aside');
  root.className = 'cat-companion';
  root.setAttribute('aria-label', '互动陪伴');
  root.innerHTML = `
    <button class="yarn-toggle" type="button" aria-label="打开互动陪伴" aria-expanded="false" aria-controls="cat-companion-panel">
      <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="23" cy="23" r="14"/><path d="M12 14c9 0 19 8 22 17M9 22c9-1 17 5 21 13M13 32c3-9 10-16 19-18M18 36c3-9 10-15 18-16M13 13c-1 9 7 17 17 19M35 30c7 3 7 10 1 11-4 1-6-2-3-4"/></svg>
    </button>
    <section id="cat-companion-panel" class="cat-panel" hidden aria-label="互动素材">
      <button class="cat-close" type="button" aria-label="收起">×</button>
      <button class="cat-touch" type="button" aria-label="点击抚摸一次" disabled><img class="cat-frame" alt="" draggable="false"></button>
      <button class="cat-switch" type="button" aria-label="切换素材" title="切换素材">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14m-4-4 4 4-4 4M20 16H6m4-4-4 4 4 4"/></svg>
      </button>
      <button class="cat-customize cat-switch" type="button" aria-label="制作自己的猫猫" title="制作自己的猫猫">＋</button>
    </section>`;
  document.body.append(root);
  const toggle = root.querySelector('.yarn-toggle');
  const panel = root.querySelector('.cat-panel');
  const touch = root.querySelector('.cat-touch');
  const frame = root.querySelector('.cat-frame');
  const switcher = root.querySelector('.cat-switch');
  let index = 0, timer, active = false, queued = 0, lastClick = null, duration = 240, generation = 0;
  const sequence = [3, 0, 1, 2, 3];
  const cache = new Map();
  function preload(pet) {
    if (!cache.has(pet.id)) cache.set(pet.id, Promise.all(pet.frames.map(src => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
    }))));
    return cache.get(pet.id);
  }
  function show(n) { frame.src = pets[index].frames[n]; }
  function stop() { clearTimeout(timer); active = false; queued = 0; lastClick = null; show(3); }
  async function select(next) {
    stop(); index = next; const version = ++generation;
    duration = pets[index].duration || 240;
    show(3); touch.disabled = true;
    touch.setAttribute('aria-label', `抚摸${pets[index].name}一次`);
    frame.alt = pets[index].name;
    try { await preload(pets[index]); if (version === generation) touch.disabled = false; }
    catch { if (version === generation) touch.setAttribute('aria-label', '素材加载失败，请检查图片路径并刷新'); }
  }
  function play() {
    if (!queued || panel.hidden) { active = false; return; }
    active = true; queued--; let step = 0; show(sequence[step]);
    function advance() {
      step++; show(sequence[step]);
      if (step === 4) { active = false; if (queued) play(); }
      else timer = setTimeout(advance, duration / 4);
    }
    timer = setTimeout(advance, duration / 4);
  }
  touch.addEventListener('click', () => {
    if (touch.disabled || panel.hidden) return;
    const now = performance.now();
    duration = lastClick !== null && now - lastClick < 1500 ? Math.max(80, Math.min(1200, now - lastClick)) : (pets[index].duration || 240);
    lastClick = now; queued++;
    if (!active) play();
  });
  toggle.addEventListener('click', () => {
    toggle.hidden = true; panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    if (!touch.disabled) touch.focus(); else root.querySelector('.cat-close').focus();
  });
  function close() { stop(); panel.hidden = true; toggle.hidden = false; toggle.setAttribute('aria-expanded','false'); toggle.focus(); }
  root.querySelector('.cat-close').addEventListener('click', close);
  switcher.addEventListener('click', () => { void select((index + 1) % pets.length); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) close(); });
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  root.querySelector('.cat-customize').addEventListener('click', () => { stop(); window.TreeholePetEditor?.open(); });
  window.TreeholeCompanion = { setCustom(pet) {
    const previous = pets.findIndex(p => p.id === 'custom');
    if (previous >= 0) { cache.delete('custom'); pets[previous] = pet; } else pets.push(pet);
    toggle.hidden = true; panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    void select(pets.findIndex(p => p.id === 'custom'));
  }};
  void select(pets.findIndex(p => p.id === 'custom') >= 0 ? pets.findIndex(p => p.id === 'custom') : 0);
})();
