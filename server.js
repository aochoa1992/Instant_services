import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(root, 'data', 'solicitudes.json');
const port = Number(process.env.PORT || 3000);
const managerPin = process.env.GESTOR_PIN || randomBytes(4).toString('hex');
const allowedOrigins = new Set(['http://localhost:8081', 'http://127.0.0.1:8081', ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)]);
const serviceTypes = new Set(['Apertura de casa', 'Apertura de carro', 'Cambio de clave', 'Cambio de chapa', 'Otro servicio']);
const statuses = new Set(['pendiente', 'aceptado', 'en camino', 'completado', 'cancelado']);
let requests = [];
let writeQueue = Promise.resolve();
try { requests = JSON.parse(await readFile(dataFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

function cors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Gestor-Pin');
  }
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function authorized(req) {
  const supplied = req.headers['x-gestor-pin'];
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied), b = Buffer.from(managerPin);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new Error('Solicitud demasiado grande');
  }
  return JSON.parse(raw || '{}');
}
function save() {
  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(dataFile), { recursive: true });
    await writeFile(dataFile, JSON.stringify(requests, null, 2));
  });
  return writeQueue;
}
function clean(value, max) { return String(value || '').trim().slice(0, max); }
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    if (url.pathname === '/api/solicitudes' && req.method === 'POST') {
      const input = await body(req);
      const nombre = clean(input.nombre, 80), telefono = clean(input.telefono, 30), direccion = clean(input.direccion, 180);
      const servicio = clean(input.servicio, 50), detalle = clean(input.detalle, 500);
      if (nombre.length < 2 || !/^\+?[\d\s().-]{7,30}$/.test(telefono) || direccion.length < 8 || !serviceTypes.has(servicio)) return send(res, 400, { error: 'Revisa nombre, teléfono, dirección y tipo de servicio.' });
      const item = { id: randomUUID(), codigo: randomBytes(4).toString('hex').toUpperCase(), nombre, telefono, direccion, servicio, detalle, estado: 'pendiente', creado: new Date().toISOString(), actualizado: new Date().toISOString() };
      requests.unshift(item); await save();
      return send(res, 201, { codigo: item.codigo, estado: item.estado, servicio: item.servicio, creado: item.creado });
    }
    if (url.pathname.startsWith('/api/estado/') && req.method === 'GET') {
      const codigo = url.pathname.split('/').pop().toUpperCase();
      const item = requests.find(x => x.codigo === codigo);
      return item ? send(res, 200, { codigo: item.codigo, estado: item.estado, servicio: item.servicio, creado: item.creado, actualizado: item.actualizado, cerrajero: item.cerrajero ? { nombre: item.cerrajero.nombre, telefono: item.cerrajero.telefono } : null }) : send(res, 404, { error: 'No encontramos esa solicitud.' });
    }
    if (url.pathname === '/api/cerrajeros/servicios-disponibles' && req.method === 'GET') {
      return send(res, 200, requests.filter(item => item.estado === 'pendiente').map(({ id, servicio, direccion, detalle, creado }) => ({ id, servicio, direccion, detalle, creado })));
    }
    if (url.pathname === '/api/cerrajeros/mis-servicios' && req.method === 'GET') {
      const cerrajeroId = clean(url.searchParams.get('cerrajeroId'), 100);
      if (!cerrajeroId) return send(res, 400, { error: 'Falta identificar al cerrajero.' });
      return send(res, 200, requests.filter(item => item.cerrajero?.id === cerrajeroId));
    }
    if (url.pathname.match(/^\/api\/cerrajeros\/servicios\/[^/]+\/aceptar$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[4];
      const item = requests.find(request => request.id === id);
      if (!item) return send(res, 404, { error: 'El servicio ya no está disponible.' });
      const input = await body(req);
      const cerrajeroId = clean(input.cerrajeroId, 100), nombre = clean(input.nombre, 80), telefono = clean(input.telefono, 30);
      if (!cerrajeroId || nombre.length < 2 || !/^\+?[\d\s().-]{7,30}$/.test(telefono)) return send(res, 400, { error: 'Completa tu nombre y un teléfono válido.' });
      // La comprobación y la asignación ocurren juntas antes de guardar: solo el primer cerrajero gana.
      if (item.estado !== 'pendiente' || item.cerrajero) return send(res, 409, { error: 'Otro cerrajero ya aceptó este servicio.' });
      item.cerrajero = { id: cerrajeroId, nombre, telefono };
      item.estado = 'aceptado'; item.actualizado = new Date().toISOString();
      await save();
      return send(res, 200, item);
    }
    if (url.pathname.match(/^\/api\/cerrajeros\/servicios\/[^/]+$/) && req.method === 'PATCH') {
      const id = url.pathname.split('/').pop();
      const item = requests.find(request => request.id === id);
      if (!item) return send(res, 404, { error: 'Servicio no encontrado.' });
      const input = await body(req);
      const cerrajeroId = clean(input.cerrajeroId, 100), estado = clean(input.estado, 30);
      if (!item.cerrajero || item.cerrajero.id !== cerrajeroId) return send(res, 403, { error: 'Este servicio está asignado a otro cerrajero.' });
      const allowed = { aceptado: ['en camino', 'cancelado'], 'en camino': ['completado', 'cancelado'], completado: [], cancelado: [] };
      if (!allowed[item.estado]?.includes(estado)) return send(res, 409, { error: 'Ese cambio de estado no está permitido.' });
      item.estado = estado; item.actualizado = new Date().toISOString(); await save();
      return send(res, 200, item);
    }
    if (url.pathname === '/api/gestor/solicitudes' && req.method === 'GET') {
      if (!authorized(req)) return send(res, 401, { error: 'Clave de gestor incorrecta.' });
      return send(res, 200, requests);
    }
    if (url.pathname.match(/^\/api\/gestor\/solicitudes\/[^/]+$/) && req.method === 'PATCH') {
      if (!authorized(req)) return send(res, 401, { error: 'Clave de gestor incorrecta.' });
      const item = requests.find(x => x.id === url.pathname.split('/').pop());
      if (!item) return send(res, 404, { error: 'Solicitud no encontrada.' });
      const { estado } = await body(req);
      if (!statuses.has(estado)) return send(res, 400, { error: 'Estado no válido.' });
      const allowed = { pendiente: ['aceptado', 'cancelado'], aceptado: ['en camino', 'cancelado'], 'en camino': ['completado', 'cancelado'], completado: [], cancelado: [] };
      if (!allowed[item.estado].includes(estado)) return send(res, 409, { error: 'Ese cambio de estado no está permitido.' });
      item.estado = estado; item.actualizado = new Date().toISOString(); await save();
      return send(res, 200, item);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Método no permitido.' });
    const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(root, 'public', file);
    if (!target.startsWith(path.join(root, 'public') + path.sep)) return send(res, 404, { error: 'No encontrado.' });
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') return send(res, 404, { error: 'No encontrado.' });
    if (error instanceof SyntaxError || error.message === 'Solicitud demasiado grande') return send(res, 400, { error: 'Datos de solicitud no válidos.' });
    console.error(error); send(res, 500, { error: 'Ocurrió un problema. Intenta nuevamente.' });
  }
});
server.listen(port, () => console.log(`Cerrajería inmediata: http://localhost:${port}\nClave de gestor: ${managerPin}`));
