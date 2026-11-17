import { processOne, recoverStaleJobs } from './sync.service.js';
import { processOneReceipt, recoverStaleReceipts } from './receipt-delivery.service.js';
export function startWorker() {
  let running = false;
  let ticks = 0;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (ticks++ % 60 === 0) {
        await recoverStaleJobs();
        await recoverStaleReceipts();
      }
      for (let i = 0; i < 10; i++) {
        const invoice = await processOne();
        const receipt = await processOneReceipt();
        if (!invoice && !receipt) break;
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'worker.error',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      );
    } finally {
      running = false;
    }
  }, 1500);
  return async () => {
    clearInterval(timer);
    while (running) await new Promise((resolve) => setTimeout(resolve, 50));
  };
}
