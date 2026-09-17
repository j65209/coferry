-- coferry Design Center — Supabase schema
-- project: 브라이트비드오피스 (ckyjkxbqsyjoqpuqwoce)

create extension if not exists "pgcrypto";

-- 페이지 (노션 문서 트리)
create table if not exists public.cof_pages (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid,
  title       text not null default '',
  icon        text not null default '📄',
  status      text not null default 'todo',   -- todo | progress | review | done | hold
  sort        double precision not null default 0,
  archived    boolean not null default false,
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cof_pages_parent_idx on public.cof_pages(parent_id);
create index if not exists cof_pages_sort_idx   on public.cof_pages(sort);

-- 블록 (한 줄 = 한 행. 텍스트가 많아도 저장은 행 단위라 가볍다)
create table if not exists public.cof_blocks (
  id         uuid primary key default gen_random_uuid(),
  page_id    uuid not null,
  type       text not null default 'text',   -- text h1 h2 h3 bullet todo quote divider image file
  content    text not null default '',
  checked    boolean not null default false,
  size       text not null default 'md',     -- sm | md | lg
  indent     int  not null default 0,
  meta       jsonb not null default '{}'::jsonb,
  sort       double precision not null default 0,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists cof_blocks_page_idx on public.cof_blocks(page_id, sort);
create index if not exists cof_blocks_upd_idx  on public.cof_blocks(updated_at);

-- 피드백 / 대화 스레드
create table if not exists public.cof_comments (
  id         uuid primary key default gen_random_uuid(),
  page_id    uuid not null,
  block_id   uuid,
  author     text not null default '',
  body       text not null default '',
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists cof_comments_page_idx on public.cof_comments(page_id, created_at);

-- 업로드 파일 카탈로그 (실제 바이트는 Storage)
create table if not exists public.cof_files (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid,
  name        text not null default '',
  mime        text not null default '',
  size        bigint not null default 0,
  path        text not null default '',
  url         text not null default '',
  uploaded_by text,
  created_at  timestamptz not null default now()
);
create index if not exists cof_files_page_idx on public.cof_files(page_id, created_at);

-- 공용 설정 (로고 등)
create table if not exists public.cof_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS: 사내 전용 도구 — anon 전체 허용
alter table public.cof_pages    enable row level security;
alter table public.cof_blocks   enable row level security;
alter table public.cof_comments enable row level security;
alter table public.cof_files    enable row level security;
alter table public.cof_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cof_pages','cof_blocks','cof_comments','cof_files','cof_settings'] loop
    execute format('drop policy if exists %I on public.%I', t||'_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t||'_anon_all', t);
  end loop;
end $$;

-- Realtime
alter publication supabase_realtime add table public.cof_pages;
alter publication supabase_realtime add table public.cof_blocks;
alter publication supabase_realtime add table public.cof_comments;
alter publication supabase_realtime add table public.cof_files;
alter publication supabase_realtime add table public.cof_settings;

-- Storage 버킷 (이미지 / PDF / 엑셀)
insert into storage.buckets (id, name, public, file_size_limit)
values ('coferry', 'coferry', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists coferry_obj_all on storage.objects;
create policy coferry_obj_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'coferry') with check (bucket_id = 'coferry');
