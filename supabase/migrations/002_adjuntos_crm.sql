-- SubliApp — Migración 002: adjuntos de producción + detalle de cliente.
-- Ejecutar en el SQL Editor de Supabase (proyecto ya provisionado con schema.sql).

-- ---------- Adjuntos por venta (imágenes subidas o enlaces externos) ----------

create table if not exists venta_adjuntos (
    id uuid primary key default gen_random_uuid(),
    venta_id uuid not null references ventas(id) on delete cascade,
    tipo text not null check (tipo in ('imagen', 'enlace')),
    url text not null,
    nombre text,
    created_at timestamptz not null default now()
);

alter table venta_adjuntos enable row level security;

create policy "authenticated_full_access" on venta_adjuntos
    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- Bucket de Storage para las imágenes subidas ----------
-- Público de lectura (las URLs llevan un UUID no adivinable), escritura solo autenticados.

insert into storage.buckets (id, name, public)
values ('adjuntos', 'adjuntos', true)
on conflict (id) do nothing;

create policy "adjuntos_public_read" on storage.objects
    for select using (bucket_id = 'adjuntos');

create policy "adjuntos_authenticated_write" on storage.objects
    for insert with check (bucket_id = 'adjuntos' and auth.role() = 'authenticated');

create policy "adjuntos_authenticated_delete" on storage.objects
    for delete using (bucket_id = 'adjuntos' and auth.role() = 'authenticated');
