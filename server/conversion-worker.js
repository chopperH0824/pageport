import { parentPort, workerData } from 'node:worker_threads';
import { convertDocument } from './convert.js';

const restore = file => ({ ...file, buffer: Buffer.from(file.buffer) });
try {
  const document = await convertDocument(restore(workerData.file), workerData.images.map(restore), workerData.scratchRoot);
  parentPort.postMessage({ document });
} catch (error) {
  parentPort.postMessage({ error: error.message, status: error.status || 400 });
}
