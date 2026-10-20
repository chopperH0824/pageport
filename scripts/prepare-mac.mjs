import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, copyFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';

if(process.platform!=='darwin') throw new Error('macOS is required to prepare this build.');
const arch=process.env.PAGEPORT_ARCH || process.arch;
const hashes={
  arm64:'f82d904c2264de2a857972ad60bc4811fa4f7abb08ce7feb56569805454c9c85',
  x64:'bdb7b188264fe70387f7e9d4ae7dda58968a2bbc82793100a011c6c8cfc9fc79',
};
if(!hashes[arch]) throw new Error('Unsupported architecture.');
const dir=await mkdtemp(path.join(tmpdir(),'pageport-build-'));
await mkdir('resources',{recursive:true});
try {
  const archive=path.join(dir,'mark.tar.gz');
  execFileSync('curl',['-fsSL','--retry','3',`https://github.com/kovetskiy/mark/releases/download/v16.22.0/mark_Darwin_${arch==='x64'?'x86_64':'arm64'}.tar.gz`,'-o',archive],{stdio:'inherit'});
  const hash=createHash('sha256').update(await readFile(archive)).digest('hex');
  if(hash!==hashes[arch]) throw new Error('Mark checksum mismatch.');
  execFileSync('tar',['-xzf',archive,'-C',dir]);
  await copyFile(path.join(dir,'mark'),'resources/mark');
  await copyFile(path.join(dir,'LICENSE'),'resources/mark-LICENSE');
  await chmod('resources/mark',0o755);
  const iconset=path.join(dir,'icon.iconset');
  await mkdir(iconset);
  for(const size of [16,32,128,256,512]) {
    for(const scale of [1,2]) {
      const name=`icon_${size}x${size}${scale===2?'@2x':''}.png`;
      execFileSync('sips',['-z',String(size*scale),String(size*scale),'resources/icon.png','--out',path.join(iconset,name)],{stdio:'ignore'});
    }
  }
  execFileSync('iconutil',['-c','icns',iconset,'-o','resources/icon.icns']);
  console.log(`Prepared verified Mark 16.22.0 and icon for ${arch}.`);
} finally {await rm(dir,{recursive:true,force:true});}
