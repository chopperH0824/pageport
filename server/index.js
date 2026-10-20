import { createApp } from './app.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if (!process.env.PAGEPORT_DESKTOP_TOKEN) {
  try { process.loadEnvFile(path.join(root,'.env')); } catch(err) { if(err.code !== 'ENOENT') throw err; }
}
const app = createApp();
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root,'dist'),{index:false}));
  app.get('/{*path}',(_req,res)=>res.sendFile(path.join(root,'dist','index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({root,server:{middlewareMode:true},appType:'spa'});
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT ?? 4318);
const server = app.listen(port,process.env.HOST || '127.0.0.1',()=>{
  if (process.send) process.send({port:server.address().port});
  else console.log(`PagePort ready: http://localhost:${server.address().port}`);
});
process.on('disconnect',()=>{app.locals.dispose();server.close(()=>process.exit(0));});
