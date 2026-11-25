const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');

// Unpacks a backup ZIP into `dest`. Only plain files and folders are written; symlinks,
// duplicate names and any path that would land outside `dest` make the whole restore fail.
function extractBackup(zipPath, dest) {
  const root = path.resolve(dest);

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError) {
        reject(openError);
        return;
      }

      let failed = false;
      const seen = new Set();
      const fail = (error) => {
        if (failed) return;
        failed = true;
        zip.close();
        reject(error);
      };
      const next = () => {
        if (!failed) zip.readEntry();
      };

      zip.on('error', fail);
      zip.on('end', () => {
        if (!failed) resolve();
      });

      zip.on('entry', (entry) => {
        const name = entry.fileName;
        const target = path.resolve(root, name);
        const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;

        if (target !== root && !target.startsWith(root + path.sep)) {
          fail(new Error(`Unsafe path in backup: ${name}`));
          return;
        }
        if (fileType === 0o120000) {
          fail(new Error(`Backup contains a link, which is not allowed: ${name}`));
          return;
        }
        const key = target.toLowerCase();
        if (seen.has(key)) {
          fail(new Error(`Backup contains a duplicate entry: ${name}`));
          return;
        }
        seen.add(key);

        if (name.endsWith('/')) {
          fs.mkdir(target, { recursive: true }, (error) => (error ? fail(error) : next()));
          return;
        }

        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError);
            return;
          }
          fs.mkdir(path.dirname(target), { recursive: true }, (mkdirError) => {
            if (mkdirError) {
              stream.destroy();
              fail(mkdirError);
              return;
            }
            const out = fs.createWriteStream(target, { flags: 'wx' });
            stream.on('error', fail);
            out.on('error', fail);
            out.on('close', next);
            stream.pipe(out);
          });
        });
      });

      zip.readEntry();
    });
  });
}

module.exports = { extractBackup };
