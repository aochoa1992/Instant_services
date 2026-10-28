-- LlaveYa: administración, auditoría y cancelación de solicitudes pendientes.
-- Ejecutar una vez en Supabase > SQL Editor, después de 001_esquema_inicial.sql.

begin;

create table if not exists public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 2 and 80),
  creado_en timestamptz not null default now()
);

-- Un cerrajero suspendido vuelve a verificado = false; las funciones existentes ya lo bloquean.
alter table public.cerrajeros add column if not exists suspendido_en timestamptz;

-- Cada cambio de estado o de cerrajero asignado queda registrado.
create table if not exists public.historial_solicitudes (
  id bigint generated always as identity primary key,
  solicitud_id uuid not null references public.solicitudes(id) on delete cascade,
  estado_anterior text,
  estado_nuevo text not null,
  cerrajero_anterior uuid references public.cerrajeros(id) on delete set null,
  cerrajero_nuevo uuid references public.cerrajeros(id) on delete set null,
  actor_id uuid,
  actor_tipo text not null check (actor_tipo in ('cliente', 'cerrajero', 'admin')),
  motivo text not null default '',
  creado_en timestamptz not null default now()
);

create index if not exists historial_solicitudes_idx
  on public.historial_solicitudes (solicitud_id, creado_en);

create table if not exists public.historial_cerrajeros (
  id bigint generated always as identity primary key,
  cerrajero_id uuid not null references public.cerrajeros(id) on delete cascade,
  accion text not null check (accion in ('aprobado', 'suspendido')),
  admin_id uuid references public.admins(id) on delete set null,
  motivo text not null default '',
  creado_en timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.historial_solicitudes enable row level security;
alter table public.historial_cerrajeros enable row level security;
revoke all on public.admins, public.historial_solicitudes, public.historial_cerrajeros
  from anon, authenticated;

-- Una solicitud pendiente ahora puede cancelarse sin cerrajero asignado.
alter table public.solicitudes drop constraint if exists asignacion_coherente;
alter table public.solicitudes add constraint asignacion_coherente check (
  (estado = 'pendiente' and cerrajero_id is null and aceptado_en is null)
  or (estado in ('aceptado', 'en camino', 'completado')
      and cerrajero_id is not null and aceptado_en is not null)
  or (estado = 'cancelado' and (cerrajero_id is null) = (aceptado_en is null))
);

create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.id = auth.uid());
$$;

create or replace function public.exigir_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Administrador no autorizado' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.validar_motivo(p_motivo text)
returns text
language plpgsql immutable set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_motivo, ''))) not between 3 and 300 then
    raise exception 'Indica un motivo (entre 3 y 300 caracteres)' using errcode = '22023';
  end if;
  return btrim(p_motivo);
end;
$$;

-- Las funciones que cambian solicitudes guardan el motivo en llaveya.motivo
-- (solo para la transaccion actual) y este trigger lo copia al historial.
create or replace function public.registrar_historial_solicitud()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tipo text;
  v_estado_anterior text;
  v_cerrajero_anterior uuid;
begin
  if tg_op = 'UPDATE' then
    if new.estado is not distinct from old.estado
       and new.cerrajero_id is not distinct from old.cerrajero_id then
      return new;
    end if;
    v_estado_anterior := old.estado;
    v_cerrajero_anterior := old.cerrajero_id;
  end if;

  v_tipo := case
    when v_actor is null then 'cliente'
    when v_actor = new.cerrajero_id or v_actor = v_cerrajero_anterior then 'cerrajero'
    when exists (select 1 from public.admins a where a.id = v_actor) then 'admin'
    when exists (select 1 from public.cerrajeros c where c.id = v_actor) then 'cerrajero'
    else 'cliente'
  end;

  insert into public.historial_solicitudes
    (solicitud_id, estado_anterior, estado_nuevo, cerrajero_anterior,
     cerrajero_nuevo, actor_id, actor_tipo, motivo)
  values
    (new.id, v_estado_anterior, new.estado, v_cerrajero_anterior,
     new.cerrajero_id, v_actor, v_tipo,
     coalesce(current_setting('llaveya.motivo', true), ''));
  return new;
end;
$$;

drop trigger if exists solicitudes_historial on public.solicitudes;
create trigger solicitudes_historial
  after insert or update of estado, cerrajero_id on public.solicitudes
  for each row execute function public.registrar_historial_solicitud();

-- El cliente cancela con su codigo de seguimiento mientras nadie haya aceptado.
create or replace function public.cancelar_solicitud(p_codigo text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_cancelada uuid;
begin
  perform set_config('llaveya.motivo', 'Cancelada por el cliente', true);

  update public.solicitudes s
  set estado = 'cancelado', actualizado_en = now()
  where s.codigo = upper(btrim(p_codigo)) and s.estado = 'pendiente'
  returning s.id into v_cancelada;

  if v_cancelada is null then
    raise exception 'La solicitud ya no se puede cancelar' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funciones de administración. Todas exigen que auth.uid() este en admins.
-- ---------------------------------------------------------------------------

create or replace function public.admin_listar_cerrajeros()
returns table (
  id uuid, nombre text, telefono text, correo text, verificado boolean,
  suspendido_en timestamptz, creado_en timestamptz,
  servicios_activos bigint, servicios_completados bigint
)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.exigir_admin();

  return query
    select c.id, c.nombre, c.telefono, u.email::text, c.verificado,
           c.suspendido_en, c.creado_en,
           count(s.id) filter (where s.estado in ('aceptado', 'en camino')),
           count(s.id) filter (where s.estado = 'completado')
    from public.cerrajeros c
    join auth.users u on u.id = c.id
    left join public.solicitudes s on s.cerrajero_id = c.id
    group by c.id, u.email
    order by (c.verificado or c.suspendido_en is not null), c.creado_en desc;
end;
$$;

create or replace function public.admin_aprobar_cerrajero(
  p_cerrajero_id uuid, p_motivo text default ''
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_aprobado uuid;
begin
  perform public.exigir_admin();

  update public.cerrajeros c
  set verificado = true, suspendido_en = null
  where c.id = p_cerrajero_id and c.verificado = false
  returning c.id into v_aprobado;

  if v_aprobado is null then
    raise exception 'Cerrajero no encontrado o ya aprobado' using errcode = 'P0001';
  end if;

  insert into public.historial_cerrajeros (cerrajero_id, accion, admin_id, motivo)
  values (v_aprobado, 'aprobado', auth.uid(), left(btrim(coalesce(p_motivo, '')), 300));
end;
$$;

-- Suspender tambien sirve para rechazar un registro pendiente.
-- Los servicios que el cerrajero ya tenga asignados no cambian: el admin los reasigna.
create or replace function public.admin_suspender_cerrajero(
  p_cerrajero_id uuid, p_motivo text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_motivo text := public.validar_motivo(p_motivo); v_suspendido uuid;
begin
  perform public.exigir_admin();

  update public.cerrajeros c
  set verificado = false, suspendido_en = now()
  where c.id = p_cerrajero_id and c.suspendido_en is null
  returning c.id into v_suspendido;

  if v_suspendido is null then
    raise exception 'Cerrajero no encontrado o ya suspendido' using errcode = 'P0001';
  end if;

  insert into public.historial_cerrajeros (cerrajero_id, accion, admin_id, motivo)
  values (v_suspendido, 'suspendido', auth.uid(), v_motivo);
end;
$$;

create or replace function public.admin_listar_solicitudes(p_estado text default null)
returns table (
  id uuid, codigo text, nombre_cliente text, telefono_cliente text,
  direccion text, servicio text, detalle text, estado text,
  cerrajero_id uuid, cerrajero_nombre text, cerrajero_telefono text,
  creado_en timestamptz, actualizado_en timestamptz, aceptado_en timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.exigir_admin();

  return query
    select s.id, s.codigo, s.nombre_cliente, s.telefono_cliente,
           s.direccion, s.servicio, s.detalle, s.estado,
           s.cerrajero_id, c.nombre, c.telefono,
           s.creado_en, s.actualizado_en, s.aceptado_en
    from public.solicitudes s
    left join public.cerrajeros c on c.id = s.cerrajero_id
    where p_estado is null or s.estado = p_estado
    order by s.creado_en desc
    limit 300;
end;
$$;

create or replace function public.admin_historial_solicitud(p_solicitud_id uuid)
returns table (
  creado_en timestamptz, estado_anterior text, estado_nuevo text,
  cerrajero_anterior text, cerrajero_nuevo text,
  actor_tipo text, actor_nombre text, motivo text
)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.exigir_admin();

  return query
    select h.creado_en, h.estado_anterior, h.estado_nuevo,
           ca.nombre, cn.nombre, h.actor_tipo,
           coalesce(a.nombre, ac.nombre), h.motivo
    from public.historial_solicitudes h
    left join public.cerrajeros ca on ca.id = h.cerrajero_anterior
    left join public.cerrajeros cn on cn.id = h.cerrajero_nuevo
    left join public.admins a on a.id = h.actor_id and h.actor_tipo = 'admin'
    left join public.cerrajeros ac on ac.id = h.actor_id and h.actor_tipo = 'cerrajero'
    where h.solicitud_id = p_solicitud_id
    order by h.creado_en, h.id;
end;
$$;

create or replace function public.admin_cancelar_solicitud(
  p_solicitud_id uuid, p_motivo text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_motivo text := public.validar_motivo(p_motivo); v_cancelada uuid;
begin
  perform public.exigir_admin();
  perform set_config('llaveya.motivo', v_motivo, true);

  update public.solicitudes s
  set estado = 'cancelado', actualizado_en = now()
  where s.id = p_solicitud_id and s.estado in ('pendiente', 'aceptado', 'en camino')
  returning s.id into v_cancelada;

  if v_cancelada is null then
    raise exception 'La solicitud no existe o ya termino' using errcode = 'P0001';
  end if;
end;
$$;

-- Con p_cerrajero_id null la solicitud vuelve a Pendiente para que otro la acepte.
create or replace function public.admin_reasignar_solicitud(
  p_solicitud_id uuid, p_cerrajero_id uuid, p_motivo text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_motivo text := public.validar_motivo(p_motivo); v_reasignada uuid;
begin
  perform public.exigir_admin();
  perform set_config('llaveya.motivo', v_motivo, true);

  if p_cerrajero_id is null then
    update public.solicitudes s
    set estado = 'pendiente', cerrajero_id = null, aceptado_en = null, actualizado_en = now()
    where s.id = p_solicitud_id and s.estado in ('aceptado', 'en camino')
    returning s.id into v_reasignada;
  else
    if not exists (
      select 1 from public.cerrajeros c
      where c.id = p_cerrajero_id and c.verificado = true
    ) then
      raise exception 'El cerrajero no esta aprobado' using errcode = 'P0001';
    end if;

    update public.solicitudes s
    set estado = 'aceptado', cerrajero_id = p_cerrajero_id,
        aceptado_en = now(), actualizado_en = now()
    where s.id = p_solicitud_id
      and s.estado in ('pendiente', 'aceptado', 'en camino')
      and s.cerrajero_id is distinct from p_cerrajero_id
    returning s.id into v_reasignada;
  end if;

  if v_reasignada is null then
    raise exception 'La solicitud no se puede reasignar' using errcode = 'P0001';
  end if;
end;
$$;

-- Tiempos en minutos desde la publicacion de la solicitud.
create or replace function public.admin_metricas(p_desde timestamptz default now() - interval '30 days')
returns table (
  total bigint, pendientes bigint, en_curso bigint, completadas bigint, canceladas bigint,
  minutos_hasta_aceptar numeric, minutos_hasta_completar numeric,
  cerrajeros_por_aprobar bigint, cerrajeros_aprobados bigint
)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.exigir_admin();

  return query
    with periodo as (
      select * from public.solicitudes s where s.creado_en >= p_desde
    ), fin as (
      select h.solicitud_id, min(h.creado_en) as completado_en
      from public.historial_solicitudes h
      where h.estado_nuevo = 'completado'
      group by h.solicitud_id
    )
    select count(*),
           count(*) filter (where p.estado = 'pendiente'),
           count(*) filter (where p.estado in ('aceptado', 'en camino')),
           count(*) filter (where p.estado = 'completado'),
           count(*) filter (where p.estado = 'cancelado'),
           round(avg(extract(epoch from p.aceptado_en - p.creado_en) / 60)::numeric, 1),
           round(avg(extract(epoch from f.completado_en - p.creado_en) / 60)::numeric, 1),
           (select count(*) from public.cerrajeros c
            where c.verificado = false and c.suspendido_en is null),
           (select count(*) from public.cerrajeros c where c.verificado = true)
    from periodo p
    left join fin f on f.solicitud_id = p.id;
end;
$$;

revoke execute on function public.es_admin() from public, anon, authenticated;
revoke execute on function public.exigir_admin() from public, anon, authenticated;
revoke execute on function public.validar_motivo(text) from public, anon, authenticated;
revoke execute on function public.registrar_historial_solicitud() from public, anon, authenticated;
revoke execute on function public.cancelar_solicitud(text) from public, anon, authenticated;
revoke execute on function public.admin_listar_cerrajeros() from public, anon, authenticated;
revoke execute on function public.admin_aprobar_cerrajero(uuid,text) from public, anon, authenticated;
revoke execute on function public.admin_suspender_cerrajero(uuid,text) from public, anon, authenticated;
revoke execute on function public.admin_listar_solicitudes(text) from public, anon, authenticated;
revoke execute on function public.admin_historial_solicitud(uuid) from public, anon, authenticated;
revoke execute on function public.admin_cancelar_solicitud(uuid,text) from public, anon, authenticated;
revoke execute on function public.admin_reasignar_solicitud(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.admin_metricas(timestamptz) from public, anon, authenticated;

grant execute on function public.es_admin() to authenticated;
grant execute on function public.cancelar_solicitud(text) to anon, authenticated;
grant execute on function public.admin_listar_cerrajeros() to authenticated;
grant execute on function public.admin_aprobar_cerrajero(uuid,text) to authenticated;
grant execute on function public.admin_suspender_cerrajero(uuid,text) to authenticated;
grant execute on function public.admin_listar_solicitudes(text) to authenticated;
grant execute on function public.admin_historial_solicitud(uuid) to authenticated;
grant execute on function public.admin_cancelar_solicitud(uuid,text) to authenticated;
grant execute on function public.admin_reasignar_solicitud(uuid,uuid,text) to authenticated;
grant execute on function public.admin_metricas(timestamptz) to authenticated;

commit;
