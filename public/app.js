const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let managerPin = sessionStorage.getItem('managerPin') || '';
let refreshTimer;
function tab(name) {
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(el => el.classList.toggle('active', el.id === name));
  if (name === 'gestor' && managerPin) loadRequests();
}
document.querySelectorAll('.tab').forEach(el => el.addEventListener('click', () => tab(el.dataset.tab)));
async function api(url, options = {}) {
  const base = window.LLAVEYA_API_BASE_URL || '';
  let response;
  try { response = await fetch(`${base}${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); }
  catch { throw new Error('No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.'); }
  let result; try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la acción.');
  return result;
}
$('#requestForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button[type=submit]');
  $('#requestError').textContent = ''; button.disabled = true; button.textContent = 'Enviando…';
  try {
    const payload = Object.fromEntries(new FormData(form));
    const item = await api('/api/solicitudes', { method: 'POST', body: JSON.stringify(payload) });
    $('#successCode').textContent = item.codigo;
    $('#trackCode').value = item.codigo;
    form.classList.add('hidden'); $('#success').classList.remove('hidden');
  } catch (error) { $('#requestError').textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = 'Solicitar cerrajero <span>↗</span>'; }
});
$('#newRequest').addEventListener('click', () => { $('#requestForm').reset(); $('#requestForm').classList.remove('hidden'); $('#success').classList.add('hidden'); });
$('#trackForm').addEventListener('submit', async event => { event.preventDefault(); await track(); });
async function track() {
  const result = $('#trackResult'); result.textContent = 'Consultando…';
  try {
    const item = await api(`/api/estado/${encodeURIComponent($('#trackCode').value.trim())}`);
    result.innerHTML = `<div class="status-card"><span class="badge ${escapeHtml(item.estado)}">${escapeHtml(item.estado)}</span><h3>${escapeHtml(item.servicio)}</h3><p>Código ${escapeHtml(item.codigo)} · Actualizado ${new Date(item.actualizado).toLocaleString('es-CO')}</p></div>`;
  } catch (error) { result.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
}
$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); managerPin = $('#pin').value;
  try { await loadRequests(); sessionStorage.setItem('managerPin', managerPin); $('#loginError').textContent = ''; }
  catch (error) { managerPin = ''; $('#loginError').textContent = error.message; }
});
$('#logout').addEventListener('click', () => { managerPin = ''; sessionStorage.removeItem('managerPin'); $('#dashboard').classList.add('hidden'); $('#refresh').classList.add('hidden'); $('#loginView').classList.remove('hidden'); clearInterval(refreshTimer); });
$('#refresh').addEventListener('click', () => loadRequests().catch(showManagerError));
function showManagerError(error) { $('#requestList').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
async function loadRequests() {
  const items = await api('/api/gestor/solicitudes', { headers: { 'x-gestor-pin': managerPin } });
  $('#loginView').classList.add('hidden'); $('#dashboard').classList.remove('hidden'); $('#refresh').classList.remove('hidden');
  $('#pendingCount').textContent = items.filter(x => x.estado === 'pendiente').length;
  $('#requestList').innerHTML = items.length ? items.map(item => {
    const actions = { pendiente: [['aceptado','Aceptar servicio'],['cancelado','Cancelar']], aceptado: [['en camino','Marcar en camino'],['cancelado','Cancelar']], 'en camino': [['completado','Completar'],['cancelado','Cancelar']] }[item.estado] || [];
    return `<article class="request-card"><div class="card-top"><span class="badge ${escapeHtml(item.estado)}">${escapeHtml(item.estado)}</span><small>${new Date(item.creado).toLocaleString('es-CO')}</small></div><h3>${escapeHtml(item.servicio)}</h3><p><strong>${escapeHtml(item.nombre)}</strong> · <a href="tel:${escapeHtml(item.telefono)}">${escapeHtml(item.telefono)}</a></p><p>⌖ ${escapeHtml(item.direccion)}</p>${item.detalle ? `<p class="detail">“${escapeHtml(item.detalle)}”</p>` : ''}<div class="card-actions">${actions.map(([state,label]) => `<button type="button" class="${state === 'cancelado' ? 'cancel' : ''}" data-id="${escapeHtml(item.id)}" data-state="${state}">${label}</button>`).join('')}</div></article>`;
  }).join('') : '<div class="empty">Todavía no hay solicitudes.</div>';
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if ($('#gestor').classList.contains('active')) loadRequests().catch(showManagerError); }, 10000);
  return items;
}
$('#requestList').addEventListener('click', async event => {
  const button = event.target.closest('button[data-id]'); if (!button) return;
  button.disabled = true;
  try { await api(`/api/gestor/solicitudes/${button.dataset.id}`, { method:'PATCH', headers:{'x-gestor-pin':managerPin}, body:JSON.stringify({estado:button.dataset.state}) }); await loadRequests(); }
  catch (error) { showManagerError(error); button.disabled = false; }
});
if (managerPin) loadRequests().catch(() => { managerPin = ''; sessionStorage.removeItem('managerPin'); });
