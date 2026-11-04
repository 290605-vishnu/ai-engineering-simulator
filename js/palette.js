window.SIM = window.SIM || {};

SIM.DRAG_MIME = 'text/x-aisim-node';

SIM.initPalette = function () {
  const list = document.getElementById('palette-list');
  const search = document.getElementById('search');

  function render() {
    const q = search.value.trim().toLowerCase();
    const groups = {};
    SIM.NODE_DEFS.forEach((d) => {
      if (q && !(d.label + ' ' + d.description).toLowerCase().includes(q)) return;
      (groups[d.category] = groups[d.category] || []).push(d);
    });
    list.innerHTML = '';
    Object.entries(groups).forEach(([cat, defs]) => {
      const h = document.createElement('div');
      h.className = 'cat-title';
      h.textContent = cat;
      list.appendChild(h);
      defs.forEach((d) => {
        const locked = SIM.campaign && !SIM.campaign.isAvailable(d.id);
        const el = document.createElement('div');
        el.className = 'pal-item' + (locked ? ' locked' : '');
        el.draggable = !locked;
        el.tabIndex = 0;                         // keyboard: focus an element and press Enter to add it
        el.setAttribute('role', 'button');
        el.setAttribute('aria-disabled', locked ? 'true' : 'false');
        const desc = locked ? `🔒 Unlocks at level ${SIM.campaign.unlockLevel(d.id) || '?'}` : d.plain;
        el.innerHTML = `<div class="name">${SIM.iconLabel(d, 46)}</div><div class="desc">${desc}</div>`;
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!locked) SIM.addNodeAtCenter(d.id); }
        });
        if (!locked) el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData(SIM.DRAG_MIME, d.id);
          e.dataTransfer.effectAllowed = 'copy';
        });
        list.appendChild(el);
      });
    });
  }
  search.addEventListener('input', render);
  SIM.refreshPalette = render; // campaign calls this when the unlocked set changes
  render();
};
