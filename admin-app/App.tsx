import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from './supabase';

type Status = 'pendiente' | 'aceptado' | 'en camino' | 'completado' | 'cancelado';
type Section = 'solicitudes' | 'cerrajeros' | 'nueva' | 'metricas';
type Request = {
  id: string; codigo: string; nombre_cliente: string; telefono_cliente: string;
  direccion: string; servicio: string; detalle: string; estado: Status;
  cerrajero_id: string | null; cerrajero_nombre: string | null; cerrajero_telefono: string | null;
  creado_en: string; actualizado_en: string; aceptado_en: string | null;
};
type Locksmith = {
  id: string; nombre: string; telefono: string; correo: string; verificado: boolean;
  suspendido_en: string | null; creado_en: string; servicios_activos: number; servicios_completados: number;
};
type HistoryEvent = {
  creado_en: string; estado_anterior: Status | null; estado_nuevo: Status;
  cerrajero_anterior: string | null; cerrajero_nuevo: string | null;
  actor_tipo: 'cliente' | 'cerrajero' | 'admin'; actor_nombre: string | null; motivo: string;
};
type Metrics = {
  total: number; pendientes: number; en_curso: number; completadas: number; canceladas: number;
  minutos_hasta_aceptar: number | null; minutos_hasta_completar: number | null;
  cerrajeros_por_aprobar: number; cerrajeros_aprobados: number;
};

const statuses: Status[] = ['pendiente', 'aceptado', 'en camino', 'completado', 'cancelado'];
const services = ['Apertura de casa', 'Apertura de carro', 'Cambio de clave', 'Cambio de chapa', 'Otro servicio'];
const errorText = (e: unknown) => (e as Error).message;
const date = (value: string) => new Date(value).toLocaleString('es-CO');
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export default function App() {
  const [ready, setReady] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [section, setSection] = useState<Section>('solicitudes');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const checkAdmin = useCallback(async () => {
    const { data, error } = await supabase.rpc('es_admin');
    if (error) throw error;
    if (data !== true) {
      await supabase.auth.signOut();
      throw new Error('Esta cuenta no tiene permisos de administración.');
    }
    setAdmin(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => (data.session ? checkAdmin() : undefined))
      .catch(e => setMessage(errorText(e)))
      .finally(() => setReady(true));
  }, [checkAdmin]);

  async function login() {
    setMessage('');
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      await checkAdmin();
      setPassword('');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setAdmin(false);
    setEmail('');
    setPassword('');
    setSection('solicitudes');
  }

  if (!ready) return <View style={s.center}><ActivityIndicator color="#d6fa83" /></View>;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#17222c" />
      <View style={s.header}>
        <View style={s.logo}><Text style={s.logoText}>✳</Text></View>
        <View>
          <Text style={s.brand}>LlaveYa</Text>
          <Text style={s.pro}>ADMINISTRACIÓN</Text>
        </View>
        {admin && <Pressable onPress={logout} style={s.exit}><Text style={s.exitText}>Salir</Text></Pressable>}
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {!admin ? (
          <View>
            <Text style={s.eyebrow}>EQUIPO OPERADOR</Text>
            <Text style={s.title}>Portal de administración</Text>
            <Text style={s.subtitle}>Ingresa con una cuenta registrada como administrador.</Text>
            <View style={s.panel}>
              <Field label="Correo electrónico" value={email} onChangeText={setEmail} placeholder="correo@ejemplo.com" keyboardType="email-address" />
              <Field label="Contraseña" value={password} onChangeText={setPassword} placeholder="Contraseña" secureTextEntry />
              <Button disabled={busy || !email.trim() || !password} label="Ingresar" onPress={login} />
              {!!message && <Text style={s.error}>{message}</Text>}
            </View>
          </View>
        ) : (
          <>
            <View style={s.tabs}>
              <Tab active={section === 'solicitudes'} label="Solicitudes" onPress={() => setSection('solicitudes')} />
              <Tab active={section === 'cerrajeros'} label="Cerrajeros" onPress={() => setSection('cerrajeros')} />
              <Tab active={section === 'nueva'} label="Nueva solicitud" onPress={() => setSection('nueva')} />
              <Tab active={section === 'metricas'} label="Métricas" onPress={() => setSection('metricas')} />
            </View>
            {section === 'solicitudes' && <Requests />}
            {section === 'cerrajeros' && <Locksmiths />}
            {section === 'nueva' && <NewRequest />}
            {section === 'metricas' && <MetricsView />}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Requests() {
  const [filter, setFilter] = useState<Status | null>(null);
  const [items, setItems] = useState<Request[]>([]);
  const [locksmiths, setLocksmiths] = useState<Locksmith[]>([]);
  const [open, setOpen] = useState<{ id: string; mode: 'cancelar' | 'reasignar' | 'historial' } | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [requests, people] = await Promise.all([
      supabase.rpc('admin_listar_solicitudes', { p_estado: filter }),
      supabase.rpc('admin_listar_cerrajeros'),
    ]);
    if (requests.error) throw requests.error;
    if (people.error) throw people.error;
    setItems((requests.data || []) as Request[]);
    setLocksmiths(((people.data || []) as Locksmith[]).filter(l => l.verificado));
  }, [filter]);

  useEffect(() => {
    load().catch(e => setMessage(errorText(e)));
    const timer = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function toggle(item: Request, mode: 'cancelar' | 'reasignar' | 'historial') {
    if (open?.id === item.id && open.mode === mode) {
      setOpen(null);
      return;
    }
    setMessage('');
    setReason('');
    setTarget(null);
    setOpen({ id: item.id, mode });
    if (mode === 'historial') {
      setHistory([]);
      const { data, error } = await supabase.rpc('admin_historial_solicitud', { p_solicitud_id: item.id });
      if (error) setMessage(error.message);
      else setHistory((data || []) as HistoryEvent[]);
    }
  }

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setMessage('');
    try {
      const { error } = await action();
      if (error) throw error;
      setOpen(null);
      await load();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const cancel = (item: Request) =>
    run(() => supabase.rpc('admin_cancelar_solicitud', { p_solicitud_id: item.id, p_motivo: reason.trim() }));
  const reassign = (item: Request) =>
    run(() => supabase.rpc('admin_reasignar_solicitud', { p_solicitud_id: item.id, p_cerrajero_id: target, p_motivo: reason.trim() }));

  return (
    <View style={s.panel}>
      <View style={s.listHead}>
        <Text style={s.heading}>Solicitudes</Text>
        <Pressable disabled={busy} onPress={() => load().catch(e => setMessage(errorText(e)))}><Text style={s.link}>Actualizar ↻</Text></Pressable>
      </View>
      <View style={s.chips}>
        <Chip active={filter === null} label="Todas" onPress={() => setFilter(null)} />
        {statuses.map(st => <Chip key={st} active={filter === st} label={capitalize(st)} onPress={() => setFilter(st)} />)}
      </View>
      {!!message && <Text style={s.error}>{message}</Text>}
      {busy && <ActivityIndicator color="#3f6e8c" style={{ marginVertical: 10 }} />}
      {!items.length && <Text style={s.empty}>No hay solicitudes con este filtro.</Text>}
      {items.map(item => {
        const active = !['completado', 'cancelado'].includes(item.estado);
        const mode = open?.id === item.id ? open.mode : null;
        return (
          <View key={item.id} style={s.card}>
            <View style={s.cardTop}>
              <Badge status={item.estado} />
              <Text style={s.small}>{item.codigo} · {date(item.creado_en)}</Text>
            </View>
            <Text style={s.cardTitle}>{item.servicio}</Text>
            <Text style={s.client}>{item.nombre_cliente}</Text>
            <Pressable onPress={() => Linking.openURL(`tel:${item.telefono_cliente}`)}><Text style={s.phone}>{item.telefono_cliente} · Llamar</Text></Pressable>
            <Text style={s.address}>⌖ {item.direccion}</Text>
            {!!item.detalle && <Text style={s.detail}>“{item.detalle}”</Text>}
            <Text style={s.assigned}>
              {item.cerrajero_nombre ? `Cerrajero: ${item.cerrajero_nombre} · ${item.cerrajero_telefono}` : 'Sin cerrajero asignado'}
            </Text>
            <View style={s.row}>
              {active && <Button compact secondary label="Reasignar" onPress={() => toggle(item, 'reasignar')} />}
              {active && <Button compact danger label="Cancelar" onPress={() => toggle(item, 'cancelar')} />}
              <Button compact secondary label="Historial" onPress={() => toggle(item, 'historial')} />
            </View>
            {mode === 'cancelar' && (
              <View style={s.drawer}>
                <Field label="Motivo de la cancelación" value={reason} onChangeText={setReason} placeholder="Por ejemplo: el cliente llamó para cancelar" />
                <Button danger disabled={busy || reason.trim().length < 3} label="Confirmar cancelación" onPress={() => cancel(item)} />
              </View>
            )}
            {mode === 'reasignar' && (
              <View style={s.drawer}>
                <Text style={s.label}>Asignar a</Text>
                <View style={s.chips}>
                  {item.cerrajero_id && <Chip active={target === null} label="Devolver a pendientes" onPress={() => setTarget(null)} />}
                  {locksmiths.filter(l => l.id !== item.cerrajero_id).map(l => (
                    <Chip key={l.id} active={target === l.id} label={`${l.nombre} (${l.servicios_activos} activos)`} onPress={() => setTarget(l.id)} />
                  ))}
                </View>
                {!locksmiths.length && <Text style={s.hint}>No hay cerrajeros aprobados.</Text>}
                <Field label="Motivo" value={reason} onChangeText={setReason} placeholder="Por ejemplo: el cerrajero no llegó" />
                <Button
                  disabled={busy || reason.trim().length < 3 || (target === null && !item.cerrajero_id)}
                  label={target ? 'Confirmar reasignación' : item.cerrajero_id ? 'Devolver a pendientes' : 'Elige un cerrajero'}
                  onPress={() => reassign(item)}
                />
              </View>
            )}
            {mode === 'historial' && (
              <View style={s.drawer}>
                {!history.length && <Text style={s.hint}>Sin cambios registrados.</Text>}
                {history.map((h, i) => (
                  <View key={i} style={s.event}>
                    <Text style={s.eventTitle}>{h.estado_anterior ? `${h.estado_anterior} → ${h.estado_nuevo}` : `Creada como ${h.estado_nuevo}`}</Text>
                    <Text style={s.small}>{date(h.creado_en)} · {h.actor_tipo}{h.actor_nombre ? ` (${h.actor_nombre})` : ''}</Text>
                    {h.cerrajero_anterior !== h.cerrajero_nuevo && (
                      <Text style={s.small}>Cerrajero: {h.cerrajero_anterior || 'ninguno'} → {h.cerrajero_nuevo || 'ninguno'}</Text>
                    )}
                    {!!h.motivo && <Text style={s.detail}>“{h.motivo}”</Text>}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Locksmiths() {
  const [filter, setFilter] = useState<'por aprobar' | 'aprobados' | 'suspendidos' | 'todos'>('por aprobar');
  const [items, setItems] = useState<Locksmith[]>([]);
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_listar_cerrajeros');
    if (error) throw error;
    setItems((data || []) as Locksmith[]);
  }, []);

  useEffect(() => { load().catch(e => setMessage(errorText(e))); }, [load]);

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setMessage('');
    try {
      const { error } = await action();
      if (error) throw error;
      setSuspending(null);
      setReason('');
      await load();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const stateOf = (l: Locksmith) => (l.verificado ? 'aprobados' : l.suspendido_en ? 'suspendidos' : 'por aprobar');
  const visible = items.filter(l => filter === 'todos' || stateOf(l) === filter);

  return (
    <View style={s.panel}>
      <View style={s.listHead}>
        <Text style={s.heading}>Cerrajeros</Text>
        <Pressable disabled={busy} onPress={() => load().catch(e => setMessage(errorText(e)))}><Text style={s.link}>Actualizar ↻</Text></Pressable>
      </View>
      <View style={s.chips}>
        {(['por aprobar', 'aprobados', 'suspendidos', 'todos'] as const).map(f => (
          <Chip key={f} active={filter === f} label={`${capitalize(f)} (${f === 'todos' ? items.length : items.filter(l => stateOf(l) === f).length})`} onPress={() => setFilter(f)} />
        ))}
      </View>
      {!!message && <Text style={s.error}>{message}</Text>}
      {busy && <ActivityIndicator color="#3f6e8c" style={{ marginVertical: 10 }} />}
      {!visible.length && <Text style={s.empty}>No hay cerrajeros en este grupo.</Text>}
      {visible.map(l => (
        <View key={l.id} style={s.card}>
          <View style={s.cardTop}>
            <View style={[s.badge, stateOf(l) === 'por aprobar' && s.pending, stateOf(l) === 'suspendidos' && s.cancelled]}>
              <Text style={s.badgeText}>{stateOf(l) === 'aprobados' ? 'aprobado' : stateOf(l) === 'suspendidos' ? 'suspendido' : 'por aprobar'}</Text>
            </View>
            <Text style={s.small}>Registro: {date(l.creado_en)}</Text>
          </View>
          <Text style={s.cardTitle}>{l.nombre}</Text>
          <Text style={s.address}>{l.correo}</Text>
          <Pressable onPress={() => Linking.openURL(`tel:${l.telefono}`)}><Text style={s.phone}>{l.telefono} · Llamar</Text></Pressable>
          <Text style={s.small}>{l.servicios_activos} servicios activos · {l.servicios_completados} completados</Text>
          <View style={s.row}>
            {!l.verificado && (
              <Button compact disabled={busy} label="Aprobar" onPress={() => run(() => supabase.rpc('admin_aprobar_cerrajero', { p_cerrajero_id: l.id }))} />
            )}
            {!l.suspendido_en && (
              <Button compact danger label={l.verificado ? 'Suspender' : 'Rechazar'} onPress={() => { setSuspending(suspending === l.id ? null : l.id); setReason(''); }} />
            )}
          </View>
          {suspending === l.id && (
            <View style={s.drawer}>
              {l.servicios_activos > 0 && <Text style={s.hint}>Tiene servicios activos: reasígnalos desde Solicitudes.</Text>}
              <Field label="Motivo" value={reason} onChangeText={setReason} placeholder="Por ejemplo: documentos incompletos" />
              <Button danger disabled={busy || reason.trim().length < 3} label="Confirmar" onPress={() => run(() => supabase.rpc('admin_suspender_cerrajero', { p_cerrajero_id: l.id, p_motivo: reason.trim() }))} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function NewRequest() {
  const [service, setService] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [detail, setDetail] = useState('');
  const [created, setCreated] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    setMessage('');
    if (!service || name.trim().length < 2 || !/^\+?[\d\s().-]{7,30}$/.test(phone.trim()) || address.trim().length < 8) {
      setMessage('Completa el servicio, nombre, teléfono y dirección.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('crear_solicitud', {
        p_nombre: name.trim(), p_telefono: phone.trim(), p_direccion: address.trim(), p_servicio: service, p_detalle: detail.trim(),
      });
      if (error) throw error;
      setCreated(data as string);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCreated('');
    setService('');
    setName('');
    setPhone('');
    setAddress('');
    setDetail('');
  }

  if (created) {
    return (
      <View style={s.panel}>
        <Text style={s.heading}>Solicitud publicada</Text>
        <Text style={s.subtitle}>Los cerrajeros aprobados ya pueden verla. Comparte este código con el cliente para que consulte el estado:</Text>
        <Text selectable style={s.code}>{created}</Text>
        <Button label="Crear otra solicitud" onPress={reset} />
      </View>
    );
  }

  return (
    <View style={s.panel}>
      <Text style={s.heading}>Nueva solicitud</Text>
      <Text style={s.subtitle}>Para clientes que piden el servicio por teléfono u otro canal.</Text>
      <Text style={s.label}>Servicio</Text>
      <View style={s.chips}>
        {services.map(item => <Chip key={item} active={service === item} label={item} onPress={() => setService(item)} />)}
      </View>
      <Field label="Nombre del cliente" value={name} onChangeText={setName} placeholder="Nombre y apellido" autoCapitalize="words" />
      <Field label="Teléfono del cliente" value={phone} onChangeText={setPhone} placeholder="300 123 4567" keyboardType="phone-pad" />
      <Field label="Dirección del servicio" value={address} onChangeText={setAddress} placeholder="Calle, número, barrio y ciudad" autoCapitalize="sentences" />
      <Field label="Detalles (opcional)" value={detail} onChangeText={setDetail} placeholder="Por ejemplo: puerta de seguridad" autoCapitalize="sentences" />
      <Button disabled={busy} label="Publicar solicitud" onPress={submit} />
      {!!message && <Text style={s.error}>{message}</Text>}
    </View>
  );
}

function MetricsView() {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setMessage('');
    const since = new Date(Date.now() - days * 86400000).toISOString();
    supabase.rpc('admin_metricas', { p_desde: since }).then(({ data, error }) => {
      if (error) setMessage(error.message);
      else setMetrics(((data || []) as Metrics[])[0] || null);
    });
  }, [days]);

  const minutes = (value: number | null) => (value === null ? '—' : `${value} min`);
  const tiles: Array<[string, string | number]> = metrics ? [
    ['Solicitudes', metrics.total],
    ['Pendientes', metrics.pendientes],
    ['En curso', metrics.en_curso],
    ['Completadas', metrics.completadas],
    ['Canceladas', metrics.canceladas],
    ['Tiempo hasta aceptar', minutes(metrics.minutos_hasta_aceptar)],
    ['Tiempo hasta completar', minutes(metrics.minutos_hasta_completar)],
    ['Cerrajeros por aprobar', metrics.cerrajeros_por_aprobar],
    ['Cerrajeros aprobados', metrics.cerrajeros_aprobados],
  ] : [];

  return (
    <View style={s.panel}>
      <Text style={s.heading}>Métricas</Text>
      <View style={s.chips}>
        {[7, 30, 90].map(d => <Chip key={d} active={days === d} label={`Últimos ${d} días`} onPress={() => setDays(d)} />)}
      </View>
      {!!message && <Text style={s.error}>{message}</Text>}
      <View style={s.tiles}>
        {tiles.map(([label, value]) => (
          <View key={label} style={s.tile}>
            <Text style={s.tileValue}>{value}</Text>
            <Text style={s.tileLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.hint}>Los tiempos se miden desde que se publica la solicitud. Los cerrajeros se cuentan sin importar el periodo.</Text>
    </View>
  );
}

function Field(props: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder: string;
  keyboardType?: 'phone-pad' | 'email-address'; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'words' | 'sentences';
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{props.label}</Text>
      <TextInput placeholderTextColor="#8d96a0" style={s.input} autoCapitalize="none" {...props} />
    </View>
  );
}

function Button({ label, onPress, disabled, compact, danger, secondary }: {
  label: string; onPress: () => void; disabled?: boolean; compact?: boolean; danger?: boolean; secondary?: boolean;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.button, compact && s.compact, secondary && s.secondary, danger && s.danger, disabled && { opacity: 0.5 }]}>
      <Text style={[s.buttonText, secondary && s.secondaryText, danger && s.dangerText]}>{label}</Text>
    </Pressable>
  );
}

const Tab = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={[s.tab, active && s.tabActive]}><Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text></Pressable>
);
const Chip = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]}><Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text></Pressable>
);
const Badge = ({ status }: { status: Status }) => (
  <View style={[s.badge, status === 'pendiente' && s.pending, status === 'cancelado' && s.cancelled]}><Text style={s.badgeText}>{status}</Text></View>
);

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f3f4' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17222c' },
  header: { backgroundColor: '#17222c', paddingHorizontal: 20, paddingVertical: 15, flexDirection: 'row', alignItems: 'center' },
  logo: { backgroundColor: '#d6fa83', width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  logoText: { fontSize: 27 },
  brand: { fontSize: 20, fontWeight: '900', color: '#fff' },
  pro: { fontSize: 8, fontWeight: '800', letterSpacing: 1.7, color: '#d6fa83' },
  exit: { marginLeft: 'auto' },
  exitText: { color: '#b8c3cc', fontSize: 12, fontWeight: '700' },
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', padding: 18, paddingTop: 28, paddingBottom: 40 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 2, color: '#4f7290' },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '900', letterSpacing: -1.2, color: '#1d2830', marginTop: 10 },
  subtitle: { fontSize: 15, lineHeight: 22, color: '#68737c', marginTop: 6, marginBottom: 20 },
  panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe3e6', borderRadius: 16, padding: 20 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: '#d3d9dd', marginBottom: 16 },
  tab: { paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#3f6e8c' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#77818a' },
  tabTextActive: { color: '#1f4762' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '900', color: '#1f2a32' },
  link: { fontWeight: '800', color: '#3f6e8c', fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 14 },
  chip: { borderWidth: 1, borderColor: '#d3d9dd', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { backgroundColor: '#1f4762', borderColor: '#1f4762' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#4d5862' },
  chipTextActive: { color: '#fff' },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '800', color: '#2a3238', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#d3d9dd', borderRadius: 10, padding: 12, fontSize: 15, color: '#20282e', backgroundColor: '#fff' },
  button: { backgroundColor: '#1f4762', padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  compact: { paddingHorizontal: 12, paddingVertical: 9 },
  secondary: { backgroundColor: '#eaf0f4' },
  secondaryText: { color: '#1f4762' },
  danger: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d9aaa2' },
  dangerText: { color: '#a3483e' },
  card: { borderWidth: 1, borderColor: '#e1e5e8', borderRadius: 13, padding: 16, marginTop: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  cardTitle: { fontSize: 18, fontWeight: '900', color: '#1f2a32', marginTop: 10 },
  client: { fontSize: 15, fontWeight: '800', color: '#3d464d', marginTop: 6 },
  phone: { color: '#2f6687', fontWeight: '800', marginTop: 4 },
  address: { fontSize: 14, color: '#5d676f', marginTop: 6 },
  detail: { fontSize: 13, color: '#737d85', fontStyle: 'italic', marginTop: 6 },
  assigned: { fontSize: 13, fontWeight: '700', color: '#3d5a6e', marginTop: 8 },
  small: { fontSize: 11, color: '#88929a', marginTop: 2 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
  drawer: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eceff1' },
  event: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f2f3' },
  eventTitle: { fontSize: 13, fontWeight: '800', color: '#2a3238', textTransform: 'capitalize' },
  badge: { backgroundColor: '#e3f0e6', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 },
  pending: { backgroundColor: '#fff0cc' },
  cancelled: { backgroundColor: '#f7e2df' },
  badgeText: { fontSize: 11, fontWeight: '900', color: '#3f5a4a', textTransform: 'capitalize' },
  code: { fontSize: 22, fontWeight: '800', letterSpacing: 1, color: '#1f2a32', marginBottom: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: 160, borderWidth: 1, borderColor: '#e1e5e8', borderRadius: 12, padding: 14 },
  tileValue: { fontSize: 24, fontWeight: '900', color: '#1f2a32' },
  tileLabel: { fontSize: 12, color: '#6c767e', marginTop: 4 },
  hint: { fontSize: 12, color: '#848e96', lineHeight: 18, marginTop: 10 },
  empty: { textAlign: 'center', paddingVertical: 30, color: '#86909a' },
  error: { color: '#ad4944', fontSize: 13, marginTop: 12 },
});
