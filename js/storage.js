// StorageAdapter: the seam for a future backend. Swap LocalStorageAdapter for an ApiAdapter
// that implements the same methods without touching the UI.
//   load(slot) / save(graph, slot)   editor graphs; slot 'sandbox' or 'level:<id>'
//   loadProgress() / saveProgress(p) campaign progress: { levels: { <id>: { stars } } }
window.SIM = window.SIM || {};

SIM.LocalStorageAdapter = {
  // v2 keys: the campaign was re-numbered into 5 tiers, so v1 progress/layouts would point at the wrong levels.
  keyFor(slot) { return 'aisim.slot2.' + slot; },
  read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  },
  load(slot = 'sandbox') { return this.read(this.keyFor(slot)); },
  save(graph, slot = 'sandbox') { this.write(this.keyFor(slot), graph); },
  loadProgress() { return this.read('aisim.progress.v2') || { levels: {} }; },
  saveProgress(p) { this.write('aisim.progress.v2', p); },
};
SIM.storage = SIM.LocalStorageAdapter;
