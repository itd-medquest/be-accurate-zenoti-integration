import { processOne, recoverStaleJobs } from './sync.service.js';
export function startWorker() {
  let running = false;
  let ticks = 0;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (ticks++ % 60 === 0) await recoverStaleJobs();
      for (let i = 0; i < 10; i++) {
        if (!(await processOne())) break;
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
