-- =====================================================================
-- Catálogo Top Fest – estrutura do banco e regras de segurança (RLS)
-- Cole tudo no Supabase > SQL Editor > New query e clique em "Run".
-- Pode ser executado de novo sem problemas (não apaga dados).
-- =====================================================================

-- ---------- Administradoras ----------
-- Só quem estiver nesta tabela pode alterar o catálogo.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Configurações (uma linha só) ----------
create table if not exists public.configuracoes (
  id int primary key default 1 check (id = 1),
  nome text not null default 'Chácara Top Fest',
  slogan text not null default 'Lazer, eventos e decorações',
  whatsapp_orcamentos text not null default '5519991616329'
    check (whatsapp_orcamentos ~ '^[0-9]{10,15}$'),
  whatsapp_exibicao text not null default '(19) 99161-6329',
  telefone_secundario text not null default '',
  mostrar_precos boolean not null default false,
  atualizado_em timestamptz not null default now()
);
insert into public.configuracoes (id) values (1) on conflict (id) do nothing;

-- ---------- Categorias ----------
create table if not exists public.categorias (
  id bigint generated always as identity primary key,
  nome text not null unique check (length(trim(nome)) > 0),
  icone text not null default '🎉',
  tipo text not null default 'produtos' check (tipo in ('produtos', 'galeria')),
  ordem int not null default 0,
  atualizado_em timestamptz not null default now()
);

-- ---------- Produtos ----------
create table if not exists public.produtos (
  id text primary key default ('p' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  categoria_id bigint not null references public.categorias (id) on update cascade on delete restrict,
  nome text not null check (length(trim(nome)) > 0),
  descricao text not null default '',
  imagem text,              -- caminho no Storage (bucket "catalogo"), ex.: produtos/p080.jpg
  ativo boolean not null default true,
  ordem int not null default 0,
  preco numeric(10, 2),     -- opcional; só aparece se configuracoes.mostrar_precos = true
  atualizado_em timestamptz not null default now()
);
create index if not exists produtos_categoria_ordem on public.produtos (categoria_id, ordem);

-- ---------- Inspirações (galeria) ----------
create table if not exists public.inspiracoes (
  id text primary key default ('i' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  imagem text not null,
  legenda text not null default '',
  ordem int not null default 0,
  atualizado_em timestamptz not null default now()
);

-- ---------- Data de atualização automática ----------
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['configuracoes', 'categorias', 'produtos', 'inspiracoes'] loop
    execute format('drop trigger if exists tocar_atualizado_em on public.%I', t);
    execute format('create trigger tocar_atualizado_em before update on public.%I
                    for each row execute function public.tocar_atualizado_em()', t);
  end loop;
end $$;

-- ---------- Regras de segurança (RLS) ----------
alter table public.admins        enable row level security;
alter table public.configuracoes enable row level security;
alter table public.categorias    enable row level security;
alter table public.produtos      enable row level security;
alter table public.inspiracoes   enable row level security;

-- admins: cada usuária só consegue ver se ela mesma é admin; ninguém altera pelo site.
drop policy if exists "admins: ver a si mesma" on public.admins;
create policy "admins: ver a si mesma" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Leitura pública
drop policy if exists "leitura publica" on public.configuracoes;
create policy "leitura publica" on public.configuracoes for select using (true);

drop policy if exists "leitura publica" on public.categorias;
create policy "leitura publica" on public.categorias for select using (true);

drop policy if exists "leitura publica" on public.inspiracoes;
create policy "leitura publica" on public.inspiracoes for select using (true);

-- Produtos ocultos só aparecem para a administradora.
drop policy if exists "leitura publica" on public.produtos;
create policy "leitura publica" on public.produtos
  for select using (ativo or public.is_admin());

-- Escrita somente para administradora
do $$
declare t text;
begin
  foreach t in array array['configuracoes', 'categorias', 'produtos', 'inspiracoes'] loop
    execute format('drop policy if exists "admin insere" on public.%I', t);
    execute format('drop policy if exists "admin altera" on public.%I', t);
    execute format('drop policy if exists "admin exclui" on public.%I', t);
    execute format('create policy "admin insere" on public.%I for insert to authenticated
                    with check (public.is_admin())', t);
    execute format('create policy "admin altera" on public.%I for update to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy "admin exclui" on public.%I for delete to authenticated
                    using (public.is_admin())', t);
  end loop;
end $$;

-- Configurações nunca são excluídas (só alteradas).
drop policy if exists "admin exclui" on public.configuracoes;

-- ---------- Fotos (Storage) ----------
-- Bucket público para leitura; só imagens de até 2 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogo', 'catalogo', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "catalogo: admin envia" on storage.objects;
create policy "catalogo: admin envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'catalogo' and public.is_admin());

drop policy if exists "catalogo: admin altera" on storage.objects;
create policy "catalogo: admin altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'catalogo' and public.is_admin())
  with check (bucket_id = 'catalogo' and public.is_admin());

drop policy if exists "catalogo: admin exclui" on storage.objects;
create policy "catalogo: admin exclui" on storage.objects
  for delete to authenticated
  using (bucket_id = 'catalogo' and public.is_admin());

-- Permite à administradora listar arquivos pelo painel (a leitura das fotos
-- no site é feita pela URL pública do bucket, que não depende desta regra).
drop policy if exists "catalogo: admin lista" on storage.objects;
create policy "catalogo: admin lista" on storage.objects
  for select to authenticated
  using (bucket_id = 'catalogo' and public.is_admin());

-- ---------- Permissões da API ----------
-- (as regras acima continuam valendo; isto só libera o acesso pela API)
grant usage on schema public to anon, authenticated;
grant select on public.configuracoes, public.categorias, public.produtos, public.inspiracoes to anon, authenticated;
grant insert, update, delete on public.configuracoes, public.categorias, public.produtos, public.inspiracoes to authenticated;
grant select on public.admins to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
