import { randomBytes, timingSafeEqual } from 'node:crypto';

const equal = (a, b) => {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
};

// The public website cannot discover or authenticate to this listener. A fresh
// single-use capability is handed to the browser in a fragment, never a query.
export function createGatewayGuard(initialToken) {
  if (!/^[a-f0-9]{64}$/.test(initialToken || '')) throw new Error('Invalid gateway capability.');
  let launchToken = initialToken;
  let launchExpires = Date.now() + 120000;
  const browserToken = randomBytes(32).toString('hex');
  const rotate = token => {
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Invalid gateway capability.');
    launchToken = token;
    launchExpires = Date.now() + 120000;
  };
  const guard = (req, res, next) => {
    const host = `127.0.0.1:${req.socket.localPort}`;
    const origin = `http://${host}`;
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    if (req.get('host') !== host || (req.get('origin') && req.get('origin') !== origin) ||
      req.get('sec-fetch-site') === 'cross-site') return res.status(403).send('仅允许本机浏览器访问，请从网关窗口重新打开。');
    if (req.method === 'GET' && req.path === '/gateway-launch') {
      return res.type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PagePort 本地网关</title><p id="status">正在打开本地工作区…</p><script src="/gateway-launch.js"></script></html>');
    }
    if (req.method === 'GET' && req.path === '/gateway-launch.js') {
      return res.type('js').send(`(async()=>{const token=location.hash.slice(1);history.replaceState(null,'','/gateway-launch');try{const r=await fetch('/gateway/session',{method:'POST',headers:{'X-PagePort-Launch':token}});if(!r.ok)throw Error();location.replace('/');}catch{document.getElementById('status').textContent='启动链接已失效，请在本地网关窗口点击「打开工作区」。';}})();`);
    }
    const cookieName = `pageport-gateway-${req.socket.localPort}`;
    if (req.method === 'POST' && req.path === '/gateway/session') {
      if (req.get('origin') !== origin || Date.now() > launchExpires || !launchToken ||
        !equal(req.get('X-PagePort-Launch'), launchToken)) return res.sendStatus(403);
      launchToken = '';
      res.cookie(cookieName, browserToken, { httpOnly: true, sameSite: 'strict', path: '/' });
      return res.json({ ok: true });
    }
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!equal(cookie, browserToken)) return res.status(403).type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>PagePort 本地网关</title><p>请在本地网关窗口点击「打开工作区」。</p></html>');
    next();
  };
  return { guard, rotate };
}
