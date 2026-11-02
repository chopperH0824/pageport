const { BrowserWindow } = require('electron');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZWQAAAAASUVORK5CYII=';
module.exports = async ({ origin, token, controller }) => {
  const output = process.env.PAGEPORT_SMOKE_DIR;
  if (!output) throw new Error('An isolated gateway smoke output is required.');
  await mkdir(output, { recursive: true });
  assert.equal((await fetch(origin + '/api/bootstrap')).status, 403);
  const browser = new BrowserWindow({ width: 1440, height: 960, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `gateway-smoke-${Date.now()}` } });
  const js = code => browser.webContents.executeJavaScript(code, true);
  const wait = async code => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { if (await js(code)) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error(`Gateway browser assertion timed out: ${code}`);
  };
  await browser.loadURL(`${origin}/gateway-launch#${token}`);
  await wait(`!!document.querySelector('[aria-label="新建空白文档"]')`);
  console.log('Gateway browser authenticated.');
  await js(`window.showSaveFilePicker=undefined`);
  assert.equal(await js('typeof window.pageportDesktop'), 'undefined');
  assert.equal(await js('location.hash'), '');
  const bootstrap = await js(`fetch('/api/bootstrap').then(r=>r.json())`);
  assert.equal(bootstrap.gateway, true);
  const html = `<h1>Gateway sample</h1><p>Local document</p><img src="data:image/png;base64,${png}" alt="sample"><h2>Second section</h2><p>Preserved image</p>`;
  await js(`(() => {const input=document.querySelector('input[type=file]'); const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(html)}],'gateway.html',{type:'text/html'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('.prose-editor')?.textContent.includes('Second section')`);
  console.log('Gateway document imported.');
  await js(`(() => {const e=document.querySelector('.prose-editor'); e.focus(); const range=document.createRange();range.selectNodeContents(e.querySelector('p'));const s=getSelection();s.removeAllRanges();s.addRange(range);document.execCommand('insertText',false,'Edited locally');})()`);
  await wait(`document.querySelector('.prose-editor')?.textContent.includes('Edited locally')`);
  const saving = [];
  for (const format of ['docx', 'doc', 'md']) {
    const saved = path.join(output, `gateway-saved.${format}`);
    const complete = new Promise((resolve, reject) => {
      browser.webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(saved);
        item.once('done', (_e, state) => state === 'completed' ? resolve() : reject(new Error('Gateway download failed.')));
      });
    });
    await js(`(() => {const s=document.querySelector('[aria-label="保存格式"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,${JSON.stringify(format)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(`document.querySelector('[aria-label="保存格式"]').value===${JSON.stringify(format)}`);
    await js(`document.querySelector('[aria-label="保存到文件"]').click()`);
    let timer;
    await Promise.race([complete, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Gateway ${format} download timed out.`)), 25000);
    })]).finally(() => clearTimeout(timer));
    const bytes = await readFile(saved);
    if (format === 'docx') {
      const zip = await JSZip.loadAsync(bytes);
      const media = Object.values(zip.files).filter(f => f.name.startsWith('word/media/') && !f.dir);
      assert.ok((await Promise.all(media.map(f => f.async('nodebuffer')))).some(b => b.equals(Buffer.from(png, 'base64'))));
      assert.match(await zip.file('word/document.xml').async('string'), /Edited locally/);
    } else {
      assert.ok(bytes.toString().replace(/\s/g, '').includes(png));
      const text = format === 'doc'
        ? (await (await import('../server/confluence-export.js')).extractConfluenceExport(bytes)).html
        : bytes.toString();
      assert.match(text, /Edited locally/);
    }
    saving.push({ format, passed: true });
    console.log(`Gateway ${format} image verified.`);
  }
  await writeFile(path.join(output, 'gateway-controller.png'), (await controller.webContents.capturePage()).toPNG());
  assert.ok(await controller.webContents.executeJavaScript('document.documentElement.scrollHeight<=innerHeight'), 'Gateway controller overflow.');
  await js(`document.querySelector('[aria-label="本机备份"]').click()`);
  await wait(`!!document.querySelector('#settings-backups')?.checkVisibility()`);
  assert.equal(await js(`!!document.querySelector('.backup-open-folder')`), false);
  await js(`document.querySelector('[aria-label="关闭设置"]').click()`);
  for (const width of [1440, 940, 390]) {
    browser.setSize(width, 900);
    await new Promise(r => setTimeout(r, 200));
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`), `Overflow at ${width}`);
    await writeFile(path.join(output, `gateway-browser-${width}.png`), (await browser.webContents.capturePage()).toPNG());
  }
  await writeFile(path.join(output, 'gateway-smoke.json'), JSON.stringify({ passed: true, authenticated: true, noDesktopBridge: true, saving }, null, 2));
  browser.destroy();
};
