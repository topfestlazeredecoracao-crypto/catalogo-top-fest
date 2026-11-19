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

-- Código do produto (001, 002…): o cliente manda no WhatsApp para facilitar o orçamento.
alter table public.produtos add column if not exists codigo int;
-- Mostrar o preço deste produto no site (vale só se o botão geral estiver ligado).
alter table public.produtos add column if not exists mostrar_preco boolean not null default true;
-- Quantidade de peças que a Top Fest tem (aparece no site como "Quant"; os produtos que já existem ficam com 1).
alter table public.produtos add column if not exists quantidade int not null default 1
  constraint produtos_quantidade_valida check (quantidade between 0 and 99999);

-- Numera os produtos que ainda não têm código, na ordem do catálogo.
with ordenados as (
  select p.id,
         coalesce((select max(codigo) from public.produtos), 0)
           + row_number() over (order by c.ordem, c.id, p.ordem, p.nome) as n
  from public.produtos p join public.categorias c on c.id = p.categoria_id
  where p.codigo is null
)
update public.produtos p set codigo = o.n from ordenados o where p.id = o.id;

alter table public.produtos alter column codigo set not null;
create unique index if not exists produtos_codigo_unico on public.produtos (codigo);

-- ---------- Inspirações (galeria) ----------
create table if not exists public.inspiracoes (
  id text primary key default ('i' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  imagem text not null,
  legenda text not null default '',
  ordem int not null default 0,
  atualizado_em timestamptz not null default now()
);

-- ---------- Clientes (somente a administradora vê) ----------
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  whatsapp text not null default '',      -- só números, com 55 (ex.: 5519991616329)
  documento text not null default '',     -- CPF ou CNPJ, sem pontos
  email text not null default '',
  cep text not null default '',
  endereco text not null default '',
  bairro text not null default '',
  cidade text not null default '',
  observacoes text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------- Orçamentos (somente a administradora vê) ----------
-- itens: lista com { tipo: "produto" | "servico", produto_id, codigo, nome, quantidade, preco }.
-- Guarda nome e preço do momento, para o orçamento não mudar se o produto mudar depois.
create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  numero int,
  cliente_id uuid references public.clientes (id) on delete set null,
  cliente_nome text not null default '',  -- fica guardado mesmo se o cliente for excluído
  data_evento date,
  itens jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array'),
  desconto numeric(10, 2) not null default 0 check (desconto >= 0),
  taxa_entrega numeric(10, 2) not null default 0 check (taxa_entrega >= 0),
  observacoes text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists orcamentos_numero_unico on public.orcamentos (numero);

-- ---------- Numeração automática (próximo número livre) ----------
-- Usa "maior número + 1", então continua certo mesmo depois de restaurar uma cópia.
create or replace function public.proximo_codigo_produto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.codigo is null then
    new.codigo = coalesce((select max(codigo) from public.produtos), 0) + 1;
  end if;
  return new;
end;
$$;

create or replace function public.proximo_numero_orcamento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.numero is null then
    new.numero = coalesce((select max(numero) from public.orcamentos), 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists proximo_numero on public.produtos;
create trigger proximo_numero before insert on public.produtos
  for each row execute function public.proximo_codigo_produto();
drop trigger if exists proximo_numero on public.orcamentos;
create trigger proximo_numero before insert on public.orcamentos
  for each row execute function public.proximo_numero_orcamento();

alter table public.orcamentos alter column numero set not null;

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
  foreach t in array array['configuracoes', 'categorias', 'produtos', 'inspiracoes', 'clientes', 'orcamentos'] loop
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
alter table public.clientes      enable row level security;
alter table public.orcamentos    enable row level security;

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

-- Clientes e orçamentos: só a administradora lê e altera (o visitante não vê nada).
do $$
declare t text;
begin
  foreach t in array array['clientes', 'orcamentos'] loop
    execute format('drop policy if exists "somente admin" on public.%I', t);
    execute format('create policy "somente admin" on public.%I for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
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
grant select on public.configuracoes, public.categorias, public.produtos, public.inspiracoes to authenticated;
grant select on public.configuracoes, public.categorias, public.inspiracoes to anon;
-- Visitante lê os produtos, mas NÃO a coluna de preço (o preço só sai pela lista abaixo,
-- e só quando a administradora deixa aparecer).
revoke select on public.produtos from anon;
grant select (id, categoria_id, nome, descricao, imagem, ativo, ordem, codigo, mostrar_preco, atualizado_em, quantidade)
  on public.produtos to anon;
grant insert, update, delete on public.configuracoes, public.categorias, public.produtos, public.inspiracoes to authenticated;
grant select on public.admins to authenticated;
revoke all on public.clientes, public.orcamentos from anon;
grant select, insert, update, delete on public.clientes, public.orcamentos to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- Preços que podem aparecer no site ----------
-- Só produtos visíveis, com preço, com "mostrar preço" marcado e com o botão geral ligado.
-- (A lista é montada pelo banco; o visitante não consegue ver os outros preços.)
create or replace view public.precos_publicos as
  select p.id, p.preco
  from public.produtos p
  where p.ativo and p.mostrar_preco and p.preco is not null
    and exists (select 1 from public.configuracoes c where c.id = 1 and c.mostrar_precos);
grant select on public.precos_publicos to anon, authenticated;

-- ---------- Inspirações viram itens com código, preço e orçamento (01/11/2026) ----------
-- Cada foto da galeria passa a ser um produto da categoria do tipo "galeria".
-- A legenda vira a descrição. As fotos continuam no mesmo lugar do Storage.
-- Pode rodar de novo: só move o que ainda estiver na tabela antiga.
insert into public.produtos (id, categoria_id, nome, descricao, imagem, ativo, ordem)
select i.id, g.id, 'Decoração completa', i.legenda, i.imagem, true, i.ordem
from public.inspiracoes i
cross join (select id from public.categorias where tipo = 'galeria' order by ordem, id limit 1) g
where not exists (select 1 from public.produtos p where p.id = i.id)
order by i.ordem, i.id;

delete from public.inspiracoes i where exists (select 1 from public.produtos p where p.id = i.id);

-- ---------- Contrato a partir do orçamento aprovado (01/11/2026) ----------
alter table public.clientes add column if not exists rg text not null default '';

alter table public.orcamentos add column if not exists situacao text not null default 'aberto';
alter table public.orcamentos drop constraint if exists orcamentos_situacao_check;
alter table public.orcamentos add constraint orcamentos_situacao_check
  check (situacao in ('aberto', 'aprovado', 'cancelado'));
alter table public.orcamentos add column if not exists data_retirada date;
alter table public.orcamentos add column if not exists data_devolucao date;

-- Modelo do contrato (uma linha só). Só a administradora lê e altera:
-- as cláusulas têm o endereço da chácara, que não deve ficar público.
-- O texto das cláusulas é cadastrado pela área da administradora (não fica neste arquivo).
create table if not exists public.contrato_modelo (
  id int primary key default 1 check (id = 1),
  titulo text not null default 'CONTRATO DE LOCAÇÃO – ARTIGOS PARA DECORAÇÃO',
  clausulas text not null default '',
  percentual_sinal int not null default 50 check (percentual_sinal between 0 and 100),
  atualizado_em timestamptz not null default now()
);
insert into public.contrato_modelo (id) values (1) on conflict (id) do nothing;

drop trigger if exists tocar_atualizado_em on public.contrato_modelo;
create trigger tocar_atualizado_em before update on public.contrato_modelo
  for each row execute function public.tocar_atualizado_em();

alter table public.contrato_modelo enable row level security;
drop policy if exists "somente admin" on public.contrato_modelo;
create policy "somente admin" on public.contrato_modelo for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.contrato_modelo from anon;
grant select, insert, update on public.contrato_modelo to authenticated;

-- ---------- Programa de indicação (18/11/2026) ----------
-- Cada cliente tem um código (ex.: K7M2P) para o link pessoal: topfestdecoracoes.com.br/?ind=K7M2P
-- Quem chega pelo link e aluga ganha um desconto na primeira locação; quando o orçamento dessa
-- pessoa é aprovado, quem indicou ganha crédito para a próxima festa.

-- Regras do programa (a administradora muda em Configurações).
alter table public.configuracoes add column if not exists indicacao_ativa boolean not null default true;
alter table public.configuracoes add column if not exists indicacao_credito_pct int not null default 10
  check (indicacao_credito_pct between 0 and 100);
alter table public.configuracoes add column if not exists indicacao_desconto_pct int not null default 5
  check (indicacao_desconto_pct between 0 and 100);
alter table public.configuracoes add column if not exists indicacao_validade_meses int not null default 6
  check (indicacao_validade_meses between 1 and 60);

-- Código de indicação do cliente: 5 letras/números, sem os que se confundem (0/O, 1/I/L).
create or replace function public.novo_codigo_indicacao()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..5 loop
      c := c || substr(letras, 1 + floor(random() * length(letras))::int, 1);
    end loop;
    exit when not exists (select 1 from public.clientes where codigo_indicacao = c);
  end loop;
  return c;
end;
$$;
revoke execute on function public.novo_codigo_indicacao() from public, anon;
grant execute on function public.novo_codigo_indicacao() to authenticated;

alter table public.clientes add column if not exists codigo_indicacao text;
update public.clientes set codigo_indicacao = public.novo_codigo_indicacao() where codigo_indicacao is null;
alter table public.clientes alter column codigo_indicacao set default public.novo_codigo_indicacao();
alter table public.clientes alter column codigo_indicacao set not null;
alter table public.clientes drop constraint if exists clientes_codigo_indicacao_formato;
alter table public.clientes add constraint clientes_codigo_indicacao_formato
  check (codigo_indicacao ~ '^[A-Z0-9]{3,10}$');
create unique index if not exists clientes_codigo_indicacao_unico on public.clientes (codigo_indicacao);

-- No orçamento: quem indicou, desconto do indicado (%), crédito usado (R$) e crédito gerado para quem indicou.
alter table public.orcamentos add column if not exists indicado_por uuid references public.clientes (id) on delete set null;
alter table public.orcamentos add column if not exists desconto_indicacao_pct numeric(5, 2) not null default 0
  check (desconto_indicacao_pct between 0 and 100);
alter table public.orcamentos add column if not exists credito_usado numeric(10, 2) not null default 0
  check (credito_usado >= 0);
alter table public.orcamentos add column if not exists credito_pct numeric(5, 2);
alter table public.orcamentos add column if not exists credito_gerado numeric(10, 2);
alter table public.orcamentos add column if not exists credito_em date;
alter table public.orcamentos add column if not exists credito_validade date;

-- Calcula o crédito de quem indicou. Só existe enquanto o orçamento estiver "aprovado":
-- cancelou (ou voltou para "em aberto"), o crédito some. O percentual e a validade ficam
-- guardados na primeira aprovação, para não mudarem se as Configurações mudarem depois.
-- Base do crédito: itens + serviços − desconto − desconto de indicação (sem frete).
create or replace function public.calcular_credito_indicacao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cfg public.configuracoes;
  base numeric;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.situacao = 'aprovado' and new.indicado_por is not null
     and new.indicado_por is distinct from new.cliente_id then
    if new.credito_pct is null then
      select * into cfg from public.configuracoes where id = 1;
      if not coalesce(cfg.indicacao_ativa, false) or coalesce(cfg.indicacao_credito_pct, 0) = 0 then
        new.credito_gerado := null;
        new.credito_em := null;
        new.credito_validade := null;
        return new;
      end if;
      new.credito_pct := cfg.indicacao_credito_pct;
      new.credito_em := hoje;
      new.credito_validade := (hoje + make_interval(months => cfg.indicacao_validade_meses))::date;
    end if;
    select coalesce(sum(coalesce((it->>'quantidade')::numeric, 0) * coalesce((it->>'preco')::numeric, 0)), 0)
      into base from jsonb_array_elements(new.itens) it;
    base := base - round(base * new.desconto_indicacao_pct / 100, 2) - new.desconto;
    new.credito_gerado := greatest(0, round(base * new.credito_pct / 100, 2));
  else
    new.credito_pct := null;
    new.credito_gerado := null;
    new.credito_em := null;
    new.credito_validade := null;
  end if;
  return new;
end;
$$;

drop trigger if exists credito_indicacao on public.orcamentos;
create trigger credito_indicacao before insert or update on public.orcamentos
  for each row execute function public.calcular_credito_indicacao();

-- Orçamentos antigos já aprovados não geram crédito retroativo (não têm "indicado por").

-- ---------- Kits e página da Chácara (19/11/2026) ----------
-- Kits: um produto (ex.: uma inspiração) pode ter a lista dos itens que vêm nele.
-- Formato: [{ "produto_id": "...", "codigo": 12, "nome": "Arco redondo", "quantidade": 1 }]
alter table public.produtos add column if not exists kit_itens jsonb not null default '[]'::jsonb;
alter table public.produtos drop constraint if exists produtos_kit_itens_lista;
alter table public.produtos add constraint produtos_kit_itens_lista check (jsonb_typeof(kit_itens) = 'array');
grant select (kit_itens) on public.produtos to anon;

-- Novo tipo de categoria: "chacara" (os produtos dela são os pacotes de aluguel da chácara).
alter table public.categorias drop constraint if exists categorias_tipo_check;
alter table public.categorias add constraint categorias_tipo_check check (tipo in ('produtos', 'galeria', 'chacara'));

insert into public.categorias (nome, tipo, ordem)
select 'Aluguel da Chácara Top Fest', 'chacara', 0
where not exists (select 1 from public.categorias where tipo = 'chacara');

insert into public.produtos (categoria_id, nome, descricao, ativo, ordem, quantidade)
select c.id, 'Pacote completo', 'Chácara inteira: piscina, casa, salão, área gourmet e toda a estrutura.', true, 1, 1
from public.categorias c
where c.tipo = 'chacara'
  and not exists (select 1 from public.produtos p where p.categoria_id = c.id);

-- Conteúdo da página da chácara (uma linha só). Leitura pública; só a administradora altera.
-- fotos: [{ "imagem": "chacara/....webp", "legenda": "Piscina" }]
create table if not exists public.chacara_pagina (
  id int primary key default 1 check (id = 1),
  titulo text not null default '',
  chamada text not null default '',
  descricao text not null default '',
  endereco text not null default '',
  mostrar_endereco boolean not null default true,
  fotos jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array'),
  atualizado_em timestamptz not null default now()
);
alter table public.chacara_pagina enable row level security;
drop policy if exists "leitura publica" on public.chacara_pagina;
create policy "leitura publica" on public.chacara_pagina for select using (true);
drop policy if exists "admin altera" on public.chacara_pagina;
create policy "admin altera" on public.chacara_pagina for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin insere" on public.chacara_pagina;
create policy "admin insere" on public.chacara_pagina for insert to authenticated
  with check (public.is_admin());
grant select on public.chacara_pagina to anon, authenticated;
grant insert, update on public.chacara_pagina to authenticated;
insert into public.chacara_pagina (id) values (1) on conflict (id) do nothing;

-- ---------- Contrato próprio da chácara (19/11/2026) ----------
-- Usado quando o orçamento tem um pacote da chácara. As cláusulas são escritas pela administradora no painel.
alter table public.contrato_modelo add column if not exists chacara_titulo text not null default 'CONTRATO DE LOCAÇÃO – ESPAÇO PARA EVENTOS';
alter table public.contrato_modelo add column if not exists chacara_clausulas text not null default '';
alter table public.contrato_modelo add column if not exists chacara_percentual_sinal int not null default 50;
alter table public.contrato_modelo drop constraint if exists contrato_chacara_sinal_valido;
alter table public.contrato_modelo add constraint contrato_chacara_sinal_valido check (chacara_percentual_sinal between 0 and 100);

-- ---------- Indicação: percentuais próprios para o aluguel da chácara (19/11/2026) ----------
-- Começam em 0 (sem crédito e sem desconto na chácara) até a administradora configurar.
alter table public.configuracoes add column if not exists indicacao_chacara_credito_pct int not null default 0;
alter table public.configuracoes add column if not exists indicacao_chacara_desconto_pct int not null default 0;
alter table public.configuracoes drop constraint if exists configuracoes_ind_chacara_validos;
alter table public.configuracoes add constraint configuracoes_ind_chacara_validos
  check (indicacao_chacara_credito_pct between 0 and 100 and indicacao_chacara_desconto_pct between 0 and 100);

-- Cada item do orçamento pode ter "chacara": true (o painel marca ao salvar os pacotes da chácara).
alter table public.orcamentos add column if not exists desconto_indicacao_chacara_pct numeric(5,2) not null default 0;
alter table public.orcamentos add column if not exists credito_chacara_pct numeric(5,2);

-- Crédito = % da decoração sobre a parte de decoração (itens + serviços)
--         + % da chácara sobre a parte da chácara.
-- O desconto manual é dividido entre as duas partes na proporção dos valores. O frete não entra.
create or replace function public.calcular_credito_indicacao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cfg public.configuracoes;
  sub_dec numeric;
  sub_ch numeric;
  desc_dec numeric := 0;
  desc_ch numeric := 0;
  base_dec numeric;
  base_ch numeric;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.situacao = 'aprovado' and new.indicado_por is not null
     and new.indicado_por is distinct from new.cliente_id then
    if new.credito_pct is null then
      select * into cfg from public.configuracoes where id = 1;
      if not coalesce(cfg.indicacao_ativa, false)
         or (coalesce(cfg.indicacao_credito_pct, 0) = 0 and coalesce(cfg.indicacao_chacara_credito_pct, 0) = 0) then
        new.credito_chacara_pct := null;
        new.credito_gerado := null;
        new.credito_em := null;
        new.credito_validade := null;
        return new;
      end if;
      new.credito_pct := coalesce(cfg.indicacao_credito_pct, 0);
      new.credito_chacara_pct := coalesce(cfg.indicacao_chacara_credito_pct, 0);
      new.credito_em := hoje;
      new.credito_validade := (hoje + make_interval(months => cfg.indicacao_validade_meses))::date;
    end if;
    select
      coalesce(sum(case when coalesce((it->>'chacara')::boolean, false) then 0
        else coalesce((it->>'quantidade')::numeric, 0) * coalesce((it->>'preco')::numeric, 0) end), 0),
      coalesce(sum(case when coalesce((it->>'chacara')::boolean, false)
        then coalesce((it->>'quantidade')::numeric, 0) * coalesce((it->>'preco')::numeric, 0) else 0 end), 0)
      into sub_dec, sub_ch
      from jsonb_array_elements(new.itens) it;
    if sub_dec + sub_ch > 0 then
      desc_ch := round(new.desconto * sub_ch / (sub_dec + sub_ch), 2);
      desc_dec := new.desconto - desc_ch;
    end if;
    base_dec := sub_dec - round(sub_dec * new.desconto_indicacao_pct / 100, 2) - desc_dec;
    base_ch := sub_ch - round(sub_ch * new.desconto_indicacao_chacara_pct / 100, 2) - desc_ch;
    new.credito_gerado := greatest(0, round(base_dec * new.credito_pct / 100, 2))
                        + greatest(0, round(base_ch * coalesce(new.credito_chacara_pct, 0) / 100, 2));
  else
    new.credito_pct := null;
    new.credito_chacara_pct := null;
    new.credito_gerado := null;
    new.credito_em := null;
    new.credito_validade := null;
  end if;
  return new;
end;
$$;
