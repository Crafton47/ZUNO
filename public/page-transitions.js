'use strict';
// Install before first paint: pagereveal may precede scripts at the end of body.
// Skipping a visual transition rejects ready, but navigation remains successful.
(() => {
  const settle = event => {
    if (!event.viewTransition) return;
    for (const promise of [event.viewTransition.ready, event.viewTransition.finished, event.viewTransition.updateCallbackDone]) {
      promise.catch(() => {});
    }
  };
  addEventListener('pageswap', settle);
  addEventListener('pagereveal', settle);
})();

