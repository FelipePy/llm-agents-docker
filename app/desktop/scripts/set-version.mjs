// Poe a versao do projeto (arquivo VERSION na raiz, ou o argumento) no app
// desktop: tauri.conf.json e Cargo.toml. Os instaladores saem com ela no nome
// (Jarvis_1.3.0_x64-setup.exe, Jarvis_1.3.0_amd64.deb...).
// Uso: node scripts/set-version.mjs [versao]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] ?? readFileSync(join(desktop, '..', '..', 'VERSION'), 'utf8')).trim().replace(/^v/, '');
// O MSI so aceita versoes numericas (major.minor.patch).
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`versao invalida: ${version} (use major.minor.patch)`);
  process.exit(1);
}

const conf = join(desktop, 'src-tauri', 'tauri.conf.json');
const json = JSON.parse(readFileSync(conf, 'utf8'));
json.version = version;
writeFileSync(conf, JSON.stringify(json, null, 2) + '\n');

const cargo = join(desktop, 'src-tauri', 'Cargo.toml');
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));

console.log(`versao do app desktop: ${version}`);
