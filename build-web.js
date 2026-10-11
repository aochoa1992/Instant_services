import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = (process.env.API_BASE_URL || '').replace(/\/$/, '');
if (process.env.MOBILE_BUILD === '1' && !/^https:\/\/[^/]+/.test(base)) {
  throw new Error('Para iOS y Android configura API_BASE_URL con la dirección HTTPS pública del servidor.');
}
if (base && !/^https:\/\/[^/]+/.test(base)) throw new Error('API_BASE_URL debe ser una dirección HTTPS válida.');
await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });
await cp(path.join(root, 'public'), path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist', 'runtime-config.js'), `window.LLAVEYA_API_BASE_URL = ${JSON.stringify(base)};\n`);
console.log(`Web preparada en dist/ (${base || 'API del mismo origen'}).`);
