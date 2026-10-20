import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './convert.js';
import { isolatedConversion } from './conversion.js';
import { parseTarget, credentials, createConfluenceClient, validateSnapshot, summarizePage, assertUnchanged, contentSignature } from './confluence.js';

const random = () => randomBytes(24).toString('hex');
const safeEqual = (a,b) => {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x,y);
};
const sessionLifetime = 30 * 60 * 1000;
export function createApp({ fetcher = fetch, dataDir = process.env.DATA_DIR || path.resolve('data'), accessPassword = process.env.ACCESS_PASSWORD || '', allowedHosts = (process.env.CONFLUENCE_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean), production = process.env.NODE_ENV === 'production', desktopToken = process.env.PAGEPORT_DESKTOP_TOKEN || '' } = {}) {
  if (production && accessPassword.length < 16) throw new Error('Production requires ACCESS_PASSWORD with at least 16 characters.');
  const app = express(), sessions = new Map();
  let activeConversions = 0;
  app.disable('x-powered-by');
  if (desktopToken) app.use((req,res,next)=>safeEqual(req.get('X-PagePort-Desktop'),desktopToken) ? next() : res.status(403).json({error:'仅允许 PagePort 本地应用访问。'}));
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 'loopback');
  app.use(helmet({ contentSecurityPolicy: production ? { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'","'unsafe-inline'"],
    imgSrc: ["'self'",'data:','blob:'], connectSrc: ["'self'"], frameSrc: ["'self'",'blob:'],
    objectSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"], frameAncestors: ["'self'"],
  }} : false, crossOriginEmbedderPolicy: false }));
  app.use('/api', (_,res,next) => { res.set('Cache-Control','no-store'); next(); });
  app.use(express.json({ limit: '64kb' }));
  const session = (req,res,next) => {
    const cookie = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('pageport='))?.slice(9);
    let s = cookie && sessions.get(cookie);
    if (!s || s.expires < Date.now()) {
      if (cookie) sessions.delete(cookie);
      for (const [key,value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
      if (sessions.size >= 100) return next(new AppError('当前会话较多，请稍后再试。',503));
      const id = random();
      s = { id, csrf: random(), authenticated: !!desktopToken || !accessPassword, expires: Date.now()+sessionLifetime, documents: new Map(), plans: new Map() };
      sessions.set(id,s);
      res.cookie('pageport',id,{httpOnly:true,secure:production && !desktopToken,sameSite:'strict',maxAge:sessionLifetime,path:'/'});
    }
    req.session = s;
    next();
  };
  app.use('/api',session);
  app.get('/api/bootstrap',(req,res)=>res.json({csrf:req.session.csrf,authenticated:req.session.authenticated,requiresAccess:!!accessPassword && !desktopToken,desktop:!!desktopToken,hosts:req.session.authenticated?allowedHosts:[]}));
  app.use('/api',(req,res,next)=>{
    if (req.method !== 'GET') {
      if (req.headers.origin) {
        const expected = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
        if (req.headers.origin !== new URL(expected).origin) return next(new AppError('请求来源不匹配，请从本站重新打开。',403));
      }
      if (!safeEqual(req.headers['x-csrf-token'],req.session.csrf)) return next(new AppError('会话已失效，请刷新页面。',403));
    }
    next();
  });
  app.post('/api/login',rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'访问口令尝试过多，请 15 分钟后再试。'}}),(req,res,next)=>{
    if (!accessPassword || safeEqual(req.body.password,accessPassword)) {
      req.session.authenticated = true;
      return res.json({ok:true});
    }
    next(new AppError('访问口令不正确。',401));
  });
  app.use('/api',(req,res,next)=>req.session.authenticated ? next() : next(new AppError('请先输入网站访问口令。',401)));
  app.get('/api/health',(_,res)=>res.json({ok:true,engine:'Mark',compatibility:'Confluence 7.6',formats:['md','html','docx','txt']}));
  const upload = multer({ storage:multer.memoryStorage(), limits: { fileSize:10*1024*1024, files:25, fields:0, parts:25 } });
  app.post('/api/convert',rateLimit({windowMs:60*1000,limit:15,legacyHeaders:false}), (req,res,next) => {
    const length = Number(req.get('content-length'));
    if (!Number.isSafeInteger(length) || length <= 0) return next(new AppError('上传必须包含有效的文件大小。',411));
    if (length > 21*1024*1024) return next(new AppError('上传总大小不能超过 20 MB。',413));
    if (activeConversions >= 2) return next(new AppError('转换任务较多，请稍后再试。',503));
    activeConversions++;
    res.once('close',()=>{ activeConversions--; });
    next();
  }, upload.fields([{name:'document',maxCount:1},{name:'images',maxCount:24}]),async(req,res,next)=>{
    try {
      if (!req.files?.document?.[0]) throw new AppError('请先选择一个文档。');
      if (req.session.documents.size >= 1) {
        const oldest = req.session.documents.keys().next().value;
        req.session.documents.delete(oldest);
        req.session.plans.clear();
      }
      const files = [req.files.document[0],...(req.files.images || [])];
      if (files.reduce((n,f)=>n+f.size,0)>20*1024*1024) throw new AppError('文档和图片的总大小不能超过 20 MB。');
      const document = await isolatedConversion(files[0],req.files.images || []);
      document.bytes = Buffer.byteLength(document.source + document.storage + document.preview) + document.assets.reduce((n,a)=>n+a.buffer.length,0);
      const retainedBytes = [...sessions.values()].reduce((n,s)=>n+[...s.documents.values()].reduce((m,d)=>m+d.bytes,0),0);
      if (retainedBytes+document.bytes > 128*1024*1024) throw new AppError('当前文档存储已满，请清除会话或稍后再试。',503);
      const id = random();
      document.name = files[0].originalname;
      req.session.documents.set(id,document);
      res.json({id,name:document.name,title:document.title,preview:document.preview,source:document.source,warnings:document.warnings,blockers:document.blockers,stats:document.stats});
    } catch(err) { next(err); }
  });
  app.get('/api/documents/:id/storage',(req,res,next)=>{
    const doc = req.session.documents.get(req.params.id);
    if (!doc) return next(new AppError('文档已过期，请重新上传。',404));
    res.attachment('confluence-storage.xhtml').type('application/xml').send(doc.storage);
  });
  app.delete('/api/documents/:id',(req,res)=>{
    req.session.documents.delete(req.params.id); req.session.plans.clear(); res.json({ok:true});
  });
  const upstreamLimit = rateLimit({windowMs:15*60*1000,limit:12,legacyHeaders:false,standardHeaders:'draft-8',message:{error:'连接尝试较多，请稍后再试，避免公司账号被锁定。'}});
  app.post('/api/check',upstreamLimit,async(req,res,next)=>{
    try {
      // The desktop origin is protected by a per-launch secret. Its user explicitly chooses the target.
      let hosts = allowedHosts;
      if (desktopToken) {
        try { hosts = [new URL(req.body.url).hostname]; } catch { throw new AppError('请输入完整的 HTTPS Confluence 页面链接。'); }
      }
      const auth = credentials(req.body), target = parseTarget(req.body.url,hosts);
      const doc = req.session.documents.get(req.body.documentId);
      if (!doc) throw new AppError('文档已过期，请重新上传。',404);
      if (doc.blockers.length) throw new AppError('请先补齐图片或处理文档中的阻断项。');
      const page = await createConfluenceClient(auth,target,fetcher).read();
      validateSnapshot(page,target);
      const summary = summarizePage(page);
      if (summary.hasComments) throw new AppError('目标页面含行内评论。为避免丢失评论，当前版本不允许替换此页，请改用独立子页面。',409);
      const token = random();
      req.session.plans.clear();
      req.session.plans.set(token,{documentId:req.body.documentId,target,page,username:auth.username,expires:Date.now()+5*60*1000,busy:false});
      res.json({token,target:summary,url:target.url,expiresIn:300});
    } catch(err) { next(err); }
    finally { if(req.body) req.body.password = undefined; }
  });
  app.get('/api/backups/:token',(req,res,next)=>{
    const plan = req.session.plans.get(req.params.token);
    if (!plan || plan.expires < Date.now()) return next(new AppError('预检查已过期。',404));
    res.attachment(`confluence-${plan.target.id}-v${plan.page.version.number}.json`).json(plan.page);
  });
  app.post('/api/publish',upstreamLimit,async(req,res,next)=>{
    let plan;
    try {
      const auth = credentials(req.body);
      plan = req.session.plans.get(req.body.token);
      if (!plan || plan.expires < Date.now()) throw new AppError('预检查已过期，请重新检查目标页。',409);
      if (plan.busy) throw new AppError('该操作已经开始，请勿重复发布。',409);
      if (auth.username !== plan.username) throw new AppError('账号已改变，请重新检查目标页。',409);
      if (req.body.confirmTitle !== plan.page.title || req.body.acknowledge !== true) throw new AppError('请核对并输入目标页面标题，确认替换正文。');
      const doc = req.session.documents.get(plan.documentId);
      if (!doc || doc.blockers.length) throw new AppError('文档已失效或存在阻断项，请重新上传。');
      plan.busy = true;
      const client = createConfluenceClient(auth,plan.target,fetcher);
      const current = await client.read();
      validateSnapshot(current,plan.target); assertUnchanged(plan.page,current);
      const backupDir = path.join(dataDir,'backups');
      await mkdir(backupDir,{recursive:true,mode:0o700});
      const backupName = `${plan.target.id}-v${current.version.number}-${Date.now()}-${random().slice(0,8)}.json`;
      await writeFile(path.join(backupDir,backupName),JSON.stringify(current,null,2),{mode:0o600,flag:'wx'});
      for (const asset of doc.assets) await client.attach(asset);
      // Attachments may take time. Check again immediately before the optimistic versioned PUT.
      if (doc.assets.length) assertUnchanged(plan.page,await client.read());
      await client.update(current,doc.storage);
      let verification = 'unconfirmed', version = current.version.number+1;
      try {
        const saved = await client.read();
        validateSnapshot(saved,plan.target);
        version = saved.version.number;
        if (version === current.version.number+1 && JSON.stringify(contentSignature(saved.body.storage.value)) === JSON.stringify(contentSignature(doc.storage))) verification = 'matched';
        else verification = 'different';
      } catch { /* The write succeeded; a failed readback must not cause an automatic retry. */ }
      req.session.plans.delete(req.body.token);
      res.json({ok:true,url:plan.target.url,title:current.title,version,verification,backup:backupName});
    } catch(err) {
      if (plan?.busy) req.session.plans.delete(req.body.token);
      next(err);
    } finally { if(req.body) req.body.password = undefined; }
  });
  app.post('/api/logout',(req,res)=>{
    sessions.delete(req.session.id);
    res.clearCookie('pageport',{path:'/'});
    res.json({ok:true});
  });
  app.use((err,req,res,_next)=>{
    if (err instanceof multer.MulterError) return res.status(400).json({error:'上传超出限制：单文件最大 10 MB，最多 24 张图片。'});
    if (err.type === 'entity.too.large') return res.status(413).json({error:'请求体积过大。'});
    res.status(err.status || 500).json({error:err instanceof AppError ? err.message : '处理失败，请稍后再试。未确认结果时请先检查目标页面。'});
  });
  const timer = setInterval(()=>{ for(const [id,s] of sessions) if(s.expires < Date.now()) sessions.delete(id); },60000);
  timer.unref();
  app.locals.dispose = () => clearInterval(timer);
  return app;
}
