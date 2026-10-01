// Builds the read-only student edition of the extension into dist/.
// Usage: node scripts/build-student.js
// It copies extension/, swaps config.js for a read-only one, drops the recorder
// (MP3 encoder) and renames the extension. The source in extension/ is untouched.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'extension');
const out = path.join(root, 'dist', 'student');
const zip = path.join(root, 'dist', 'voice-notes-student.zip');

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.rmSync(path.join(out, 'lib'), { recursive: true, force: true });

fs.writeFileSync(path.join(out, 'config.js'), `// Student edition: can only play audio, with read-only Drive access.
const VN_CONFIG = {
  role: 'student',
  scope: 'https://www.googleapis.com/auth/drive.readonly'
};
`);

const manifestPath = path.join(out, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.name = 'Google Docs Voice Notes (Student)';
manifest.description = "Play your teacher's voice notes inside Google Docs comments.";
manifest.content_scripts[0].js = manifest.content_scripts[0].js.filter(f => !f.startsWith('lib/'));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// bsdtar ships with Windows 10+ and macOS; "-a" picks the zip format from the name.
// On Windows, name the system tar explicitly (Git Bash's tar cannot write zips).
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', out, '.']);
console.log('Built', zip);
