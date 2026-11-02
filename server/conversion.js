import { Worker } from 'node:worker_threads';
import { AppError } from './convert.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function isolatedConversion(file, images, options = {}) {
  return isolatedJob({ file, images, options });
}

export async function isolatedExport(document, format) {
  return isolatedJob({ document: { preview:document.preview,title:document.title,blockers:document.blockers }, format });
}

async function isolatedJob(data) {
  const scratchRoot=await mkdtemp(path.join(tmpdir(),'pageport-job-'));
  try { return await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./conversion-worker.js', import.meta.url), {
      workerData: { ...data, scratchRoot },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new AppError('文档转换超时，原文件未修改。请稍后重试或分段导入。', 408));
    }, 180000);
    worker.once('message', message => {
      clearTimeout(timer);
      worker.terminate();
      if (message.error) reject(new AppError(message.error, message.status));
      else if (message.exported) resolve({...message.exported,buffer:Buffer.from(message.exported.buffer)});
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
