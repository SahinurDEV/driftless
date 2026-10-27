import type { Env, JobsQueue, QueueMessage } from '../types/env';
import { processQueueMessage } from '../queue/consumer';

/** In-process queue: runs drift checks immediately (debounced by caller). */
export function createLocalQueue(getEnv: () => Env): JobsQueue {
  return {
    async send(message: QueueMessage): Promise<void> {
      // Fire-and-forget but await so tests can observe
      await processQueueMessage(message, getEnv());
    },
  };
}
