import { loadCardBrickBuilder, type BrickBuilder, type BrickController, type BrickSettings } from './card-sdk';

// Serialize creation and cleanup, including StrictMode and async create races.
export function createCardBrickManager(loadBuilder: () => Promise<BrickBuilder>) {
  let queue = Promise.resolve();
  let mounted: BrickController | null = null;
  let cleanupFailed = false;
  function enqueue(task: () => Promise<void>) {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  }
  return {
    mount(id: string, settings: BrickSettings) {
      let active = true;
      let controller: BrickController | null = null;
      let creationStarted = false;
      async function cleanup() {
        if (!controller) return;
        const previous = controller;
        controller = null;
        try { await previous.unmount(); if (mounted === previous) mounted = null; }
        catch { cleanupFailed = true; }
      }
      const ready = enqueue(async () => {
        if (!active) return;
        if (cleanupFailed || mounted) throw new Error('card_brick_busy');
        const builder = await loadBuilder();
        if (!active) return;
        const callbacks: BrickSettings['callbacks'] = {
          onReady: () => { if (active) settings.callbacks.onReady(); },
          onError: () => { if (active) settings.callbacks.onError(); },
          onSubmit: (data, additional) => active ? settings.callbacks.onSubmit(data, additional) : Promise.reject(new Error('card_brick_closed')),
        };
        creationStarted = true;
        controller = await builder.create('cardPayment', id, { ...settings, callbacks });
        mounted = controller;
        if (!active) await cleanup();
      }).catch(() => {
        if (creationStarted && !controller) cleanupFailed = true;
        if (active) settings.callbacks.onError();
      });
      return { ready, dispose() { active = false; return enqueue(cleanup); } };
    },
  };
}
export const cardBrickManager = createCardBrickManager(loadCardBrickBuilder);
