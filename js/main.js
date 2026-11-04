// Boot order matters: UI modules first, the runtime (which subscribes to the store) before store.init(),
// then the campaign decides what to show.
SIM.initA11y();
SIM.initSfx();
SIM.initPalette();
SIM.initCanvas();
SIM.initInspector();
SIM.initDashboard();
SIM.initRuntime();
SIM.initCampaign();
SIM.initShare();
SIM.initTour();
document.getElementById('btn-fit').addEventListener('click', () => SIM.fitView());
SIM.store.init();
if (!SIM.share.bootFromHash()) SIM.campaign.boot(); // a share link opens straight into its level
