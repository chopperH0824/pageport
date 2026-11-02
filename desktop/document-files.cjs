const { writeFile, rename, rm } = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

async function writeDocument(filePath, buffer) {
  const temporary = path.join(path.dirname(filePath), `.pageport-${randomBytes(16).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, buffer, { mode:0o600, flag:'wx' });
    await rename(temporary,filePath);
  } finally {
    await rm(temporary,{force:true});
  }
}

module.exports = { writeDocument };
