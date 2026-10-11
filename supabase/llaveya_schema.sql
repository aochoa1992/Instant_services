-- LlaveYa: esquema inicial para Supabase PostgreSQL.
-- Ejecutar una vez en Supabase > SQL Editor, con el proyecto correcto seleccionado.
-- Las apps deben usar Auth y estas funciones RPC; las tablas no se exponen directamente.

begin;

create table if not exists public.cerrajeros (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 2 and 80),
  telefono text not null check (telefono ~ '^\+?[0-9 () .-]{7,30}$'),
  verificado boolean not null default false,
  creado_en timestamptz not null default now()
);

create table if not exists public.solicitudes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  nombre_cliente text not null check (char_length(btrim(nombre_cliente)) between 2 and 80),
  telefono_cliente text not null check (telefono_cliente ~ '^\+?[0-9 () .-]{7,30}$'),
  direccion text not null check (char_length(btrim(direccion)) between 8 and 180),
  servicio text not null check (servicio in (
    'Apertura de casa', 'Apertura de carro', 'Cambio de clave',
    'Cambio de chapa', 'Otro servicio'
  )),
  detalle text not null default '' check (char_length(detalle) <= 500),
  estado text not null default 'pendiente' check (estado in (
    'pendiente', 'aceptado', 'en camino', 'completado', 'cancelado'
  )),
  cerrajero_id uuid references public.cerrajeros(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  aceptado_en timestamptz,
  constraint asignacion_coherente check (
    (estado = 'pendiente' and cerrajero_id is null and aceptado_en is null)
    or (estado <> 'pendiente' and cerrajero_id is not null and aceptado_en is not null)
  )
);

create index if not exists solicitudes_pendientes_idx
  on public.solicitudes (creado_en desc) where estado = 'pendiente';
create index if not exists solicitudes_cerrajero_idx
  on public.solicitudes (cerrajero_id, creado_en desc) where cerrajero_id is not null;

alter table public.cerrajeros enable row level security;
alter table public.solicitudes enable row level security;
revoke all on public.cerrajeros, public.solicitudes from anon, authenticated;

-- El cliente puede solicitar sin cuenta. El telefono NO aparece en la oferta.
create or replace function public.crear_solicitud(
  p_nombre text, p_telefono text, p_direccion text,
  p_servicio text, p_detalle text default ''
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_codigo text;
begin
  if char_length(btrim(coalesce(p_nombre, ''))) not between 2 and 80
     or coalesce(p_telefono, '') !~ '^\+?[0-9 () .-]{7,30}$'
     or char_length(btrim(coalesce(p_direccion, ''))) not between 8 and 180
     or p_servicio is null or p_servicio not in (
       'Apertura de casa', 'Apertura de carro', 'Cambio de clave',
       'Cambio de chapa', 'Otro servicio'
     )
     or char_length(coalesce(p_detalle, '')) > 500 then
    raise exception 'Datos de solicitud no validos' using errcode = '22023';
  end if;

  insert into public.solicitudes
    (nombre_cliente, telefono_cliente, direccion, servicio, detalle)
  values
    (btrim(p_nombre), btrim(p_telefono), btrim(p_direccion), p_servicio,
     btrim(coalesce(p_detalle, '')))
  returning codigo into v_codigo;
  return v_codigo;
end;
$$;

-- El codigo permite seguimiento sin revelar nombre, telefono ni direccion del cliente.
create or replace function public.consultar_estado(p_codigo text)
returns table (
  codigo text, servicio text, estado text, creado_en timestamptz,
  actualizado_en timestamptz, cerrajero_nombre text, cerrajero_telefono text
)
language sql security definer set search_path = ''
as $$
  select s.codigo, s.servicio, s.estado, s.creado_en, s.actualizado_en,
         c.nombre, c.telefono
  from public.solicitudes s
  left join public.cerrajeros c on c.id = s.cerrajero_id
  where s.codigo = upper(btrim(p_codigo));
$$;

-- El usuario de Supabase Auth crea su perfil. La aprobacion es manual.
create or replace function public.registrar_cerrajero(p_nombre text, p_telefono text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_usuario uuid := auth.uid();
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesion' using errcode = '28000';
  end if;
  if char_length(btrim(coalesce(p_nombre, ''))) not between 2 and 80
     or coalesce(p_telefono, '') !~ '^\+?[0-9 () .-]{7,30}$' then
    raise exception 'Nombre o telefono no valido' using errcode = '22023';
  end if;

  insert into public.cerrajeros (id, nombre, telefono)
  values (v_usuario, btrim(p_nombre), btrim(p_telefono))
  on conflict (id) do update
    set nombre = excluded.nombre, telefono = excluded.telefono;
end;
$$;

-- Solo los cerrajeros aprobados ven las solicitudes pendientes.
create or replace function public.listar_servicios_disponibles()
returns table (
  id uuid, servicio text, direccion text, detalle text, creado_en timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.cerrajeros c
    where c.id = auth.uid() and c.verificado = true
  ) then
    raise exception 'Cerrajero no autorizado' using errcode = '42501';
  end if;

  return query
    select s.id, s.servicio, s.direccion, s.detalle, s.creado_en
    from public.solicitudes s
    where s.estado = 'pendiente'
    order by s.creado_en desc;
end;
$$;

-- UPDATE condicional: si dos cerrajeros compiten, solo uno cambia la fila.
create or replace function public.aceptar_servicio(p_solicitud_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_usuario uuid := auth.uid(); v_aceptada uuid;
begin
  if not exists (
    select 1 from public.cerrajeros c
    where c.id = v_usuario and c.verificado = true
  ) then
    raise exception 'Cerrajero no autorizado' using errcode = '42501';
  end if;

  update public.solicitudes s
  set cerrajero_id = v_usuario, estado = 'aceptado',
      aceptado_en = now(), actualizado_en = now()
  where s.id = p_solicitud_id and s.estado = 'pendiente'
  returning s.id into v_aceptada;

  if v_aceptada is null then
    raise exception 'El servicio ya no esta disponible' using errcode = 'P0001';
  end if;
  return v_aceptada;
end;
$$;

-- Los datos personales solo son visibles para el cerrajero asignado.
create or replace function public.mis_servicios()
returns table (
  id uuid, codigo text, nombre_cliente text, telefono_cliente text,
  direccion text, servicio text, detalle text, estado text,
  creado_en timestamptz, actualizado_en timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion' using errcode = '28000';
  end if;

  return query
    select s.id, s.codigo, s.nombre_cliente, s.telefono_cliente,
           s.direccion, s.servicio, s.detalle, s.estado,
           s.creado_en, s.actualizado_en
    from public.solicitudes s
    where s.cerrajero_id = auth.uid()
    order by s.creado_en desc;
end;
$$;

create or replace function public.actualizar_estado_servicio(
  p_solicitud_id uuid, p_estado text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actualizado uuid;
begin
  update public.solicitudes s
  set estado = p_estado, actualizado_en = now()
  where s.id = p_solicitud_id
    and s.cerrajero_id = auth.uid()
    and (
      (s.estado = 'aceptado' and p_estado in ('en camino', 'cancelado'))
      or (s.estado = 'en camino' and p_estado in ('completado', 'cancelado'))
    )
  returning s.id into v_actualizado;

  if v_actualizado is null then
    raise exception 'Servicio ajeno o cambio de estado no permitido'
      using errcode = 'P0001';
  end if;
end;
$$;

-- PostgREST expone solo estas funciones; el acceso directo a tablas queda cerrado.
revoke execute on function public.crear_solicitud(text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.consultar_estado(text) from public, anon, authenticated;
revoke execute on function public.registrar_cerrajero(text,text) from public, anon, authenticated;
revoke execute on function public.listar_servicios_disponibles() from public, anon, authenticated;
revoke execute on function public.aceptar_servicio(uuid) from public, anon, authenticated;
revoke execute on function public.mis_servicios() from public, anon, authenticated;
revoke execute on function public.actualizar_estado_servicio(uuid,text) from public, anon, authenticated;

grant execute on function public.crear_solicitud(text,text,text,text,text) to anon, authenticated;
grant execute on function public.consultar_estado(text) to anon, authenticated;
grant execute on function public.registrar_cerrajero(text,text) to authenticated;
grant execute on function public.listar_servicios_disponibles() to authenticated;
grant execute on function public.aceptar_servicio(uuid) to authenticated;
grant execute on function public.mis_servicios() to authenticated;
grant execute on function public.actualizar_estado_servicio(uuid,text) to authenticated;

commit;
