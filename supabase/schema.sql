create extension if not exists vector;

create table if not exists run_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_default boolean not null default false,
  model_stage1 text not null default 'claude-haiku-4-5-20251001',
  model_stage2 text not null default 'claude-haiku-4-5-20251001',
  model_verify text not null default 'claude-sonnet-5',
  mode_ratio integer not null default 70 check (mode_ratio between 0 and 100),
  families jsonb not null default '{}'::jsonb,
  domains jsonb not null default '[]'::jsonb,
  excluded_domains jsonb not null default '["연예","정치","스포츠"]'::jsonb,
  sources jsonb not null default '{}'::jsonb,
  period_days integer not null default 7,
  auto_verify_top_n integer not null default 10 check (auto_verify_top_n between 0 and 40),
  app_list jsonb not null default '[]'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists seed_queries (
  id bigint generated always as identity primary key,
  family text not null check (family in ('workaround','question','seeking','emotion','giveup','request')),
  query_text text not null,
  domain text not null,
  active boolean not null default true,
  last_used_at timestamptz,
  origin text not null default 'manual'
);

create table if not exists run_logs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references run_configs(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  stage_counts jsonb not null default '{}'::jsonb,
  llm_calls jsonb not null default '{}'::jsonb,
  cost_estimate numeric(10,4) not null default 0,
  stopped_reason text,
  errors jsonb not null default '[]'::jsonb
);

create table if not exists raw_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_id text not null,
  url text not null,
  title text not null,
  body text not null,
  posted_at timestamptz,
  collected_at timestamptz not null default now(),
  status text not null default 'collected',
  reject_reason text,
  run_id uuid references run_logs(id) on delete set null,
  unique(source, source_id)
);

create table if not exists pain_points (
  id uuid primary key default gen_random_uuid(),
  raw_item_id uuid not null unique references raw_items(id) on delete cascade,
  pain_summary text not null,
  who text,
  current_workaround text,
  frequency text check (frequency in ('daily','weekly','monthly','occasional')),
  money_signal text,
  domain text,
  signal_type text,
  embedding vector(1024),
  cluster_id uuid,
  recurrence_count integer not null default 1,
  precision_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists competitors (
  id bigint generated always as identity primary key,
  pain_point_id uuid not null references pain_points(id) on delete cascade,
  name text not null,
  url text not null,
  pricing text,
  quality_note text,
  last_updated_signal text,
  seller_name text,
  source text not null default 'web'
);

create table if not exists scores (
  pain_point_id uuid primary key references pain_points(id) on delete cascade,
  f1 smallint not null check (f1 between 0 and 2),
  f2 smallint check (f2 between 0 and 2),
  f3 smallint check (f3 between 0 and 2),
  f4 smallint check (f4 between 0 and 3),
  f5 smallint not null check (f5 between 0 and 3),
  f6 smallint not null check (f6 between 0 and 2),
  total smallint generated always as (f1 + coalesce(f2, 0) + coalesce(f3, 0) + coalesce(f4, 0) + f5 + f6) stored,
  data_access_stable boolean not null default false,
  verdict text,
  verified boolean not null default false
);

create table if not exists industry_seeds (
  id bigint generated always as identity primary key,
  ksic_code text not null unique,
  ksic_name text not null,
  done boolean not null default false,
  translation jsonb,
  translated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists query_discoveries (
  id bigint generated always as identity primary key,
  origin text not null check (origin in ('cafe','text_mining','industry')),
  term text not null,
  category text not null,
  source_ref text not null default '',
  frequency integer not null default 1 check (frequency >= 0),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(origin, term, category, source_ref)
);

create table if not exists decisions (
  id bigint generated always as identity primary key,
  pain_point_id uuid not null references pain_points(id) on delete cascade,
  action text not null check (action in ('tracking','holding','rejected','unreviewed')),
  reason text,
  decided_at timestamptz not null default now()
);

create index if not exists pain_points_cluster_idx on pain_points(cluster_id);
create index if not exists pain_points_recurrence_idx on pain_points(recurrence_count desc);
create index if not exists raw_items_collected_idx on raw_items(collected_at desc);
create index if not exists decisions_pain_point_idx on decisions(pain_point_id, decided_at desc);
create index if not exists query_discoveries_pending_idx on query_discoveries(origin, approved_at, frequency desc);
create index if not exists industry_seeds_round_robin_idx on industry_seeds(done, created_at, id);
create index if not exists pain_points_embedding_idx on pain_points using hnsw (embedding vector_cosine_ops);
