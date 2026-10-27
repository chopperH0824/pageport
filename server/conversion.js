import { Worker } from 'node:worker_threads';
import { AppError } from './convert.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function isolatedConversion(file, images, options = {}) {
  const scratchRoot=await mkdtemp(path.join(tmpdir(),'pageport-job-'));
  try { return await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./conversion-worker.js', import.meta.url), {
      workerData: { file, images, scratchRoot, options },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new AppError('文档转换超时，请简化文档后再试。', 408));
    }, 20000);
    worker.once('message', message => {
      clearTimeout(timer);
      worker.terminate();
      if (message.error) reject(new AppError(message.error, message.status));
      else {
        message.document.assets.forEach(asset => { asset.buffer = Buffer.from(asset.buffer); });
        resolve(message.document);
      }
    });
    worker.once('error', () => { clearTimeout(timer); reject(new AppError('文档转换失败或超出资源限制。', 422)); });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new AppError('文档转换已停止。', 422));
    });
  }); } finally { await rm(scratchRoot,{recursive:true,force:true}); }
}
