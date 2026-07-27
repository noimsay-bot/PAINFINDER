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
  source_weights jsonb not null default '{"appreview":40,"blog":20,"kin":10,"cafearticle":15,"threads":15,"webkr":0}'::jsonb,
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

create table if not exists review_settings (
  id smallint primary key default 1 check (id = 1),
  queue_size integer not null default 10 check (queue_size between 5 and 30),
  min_score integer not null default 5 check (min_score between 0 and 10),
  updated_at timestamptz not null default now()
);

insert into review_settings (id, queue_size, min_score)
values (1, 10, 5)
on conflict (id) do nothing;

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
  query_text text,
  query_origin text,
  raw_payload jsonb,
  source_name text,
  author_name text,
  body_length integer not null default 0 check (body_length >= 0),
  low_confidence boolean not null default false,
  promotional_signals jsonb not null default '[]'::jsonb,
  promotional_signal_score integer not null default 0 check (promotional_signal_score >= 0),
  promotional_rule_flagged boolean not null default false,
  is_promotional boolean not null default false,
  highlight_terms jsonb not null default '[]'::jsonb,
  review_status text not null default 'eligible' check (review_status in ('eligible','auto_held','insufficient_signal')),
  review_status_reason text,
  review_override boolean not null default false,
  review_status_updated_at timestamptz,
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
  active boolean not null default true,
  section text,
  note text,
  translation jsonb,
  translated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists cafe_names (
  cafe_id text primary key,
  cafe_name text,
  fetched_at timestamptz not null default now(),
  fetch_error text
);

create table if not exists watched_cafes (
  id bigint generated always as identity primary key,
  cafe_id text not null unique,
  cafe_name text not null,
  topic_seeds jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  origin text not null default 'manual' check (origin in ('manual','candidate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists review_apps (
  id bigint generated always as identity primary key,
  name text not null,
  ios_app_id text,
  android_package text,
  ios_url text,
  android_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ios_app_id is not null or android_package is not null)
);

create unique index if not exists review_apps_ios_id_unique on review_apps(ios_app_id) where ios_app_id is not null;
create unique index if not exists review_apps_android_package_unique on review_apps(android_package) where android_package is not null;

alter table raw_items add column if not exists watched boolean not null default false;
alter table raw_items add column if not exists watched_cafe_id text references watched_cafes(cafe_id) on delete set null;
alter table raw_items add column if not exists app_target_id bigint references review_apps(id) on delete set null;
alter table raw_items add column if not exists app_name text;
alter table raw_items add column if not exists review_platform text check (review_platform in ('ios','android'));
alter table raw_items add column if not exists review_score smallint check (review_score between 1 and 5);
alter table raw_items add column if not exists app_version text;
alter table raw_items add column if not exists incumbent_dissatisfaction boolean not null default false;

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
  reason_category text,
  reason_note text,
  decided_at timestamptz not null default now()
);

create table if not exists learning_suggestions (
  id bigint generated always as identity primary key,
  suggestion_type text not null check (suggestion_type in ('keyword','promotional_keyword','domain','prompt_example')),
  value text not null,
  source_pain_point_id uuid references pain_points(id) on delete set null,
  evidence_count integer not null default 1 check (evidence_count >= 1),
  status text not null default 'pending' check (status in ('pending','approved','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(suggestion_type, value)
);

create table if not exists rule_exclusions (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('keyword','domain')),
  value text not null,
  source text not null default 'decision_learning',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(kind, value)
);

create table if not exists filter_additions (
  id bigint generated always as identity primary key,
  keyword text not null,
  kind text not null default 'keyword' check (kind in ('keyword','domain')),
  source_reason text not null,
  mode text not null check (mode in ('auto','approved')),
  origin_pain_point_id uuid references pain_points(id) on delete set null,
  added_at timestamptz not null default now(),
  active boolean not null default true,
  revoked_at timestamptz,
  unique(kind, keyword, mode)
);

alter table learning_suggestions enable row level security;
alter table rule_exclusions enable row level security;
alter table filter_additions enable row level security;
alter table watched_cafes enable row level security;
alter table review_settings enable row level security;
alter table review_apps enable row level security;

create index if not exists pain_points_cluster_idx on pain_points(cluster_id);
create index if not exists pain_points_recurrence_idx on pain_points(recurrence_count desc);
create index if not exists raw_items_collected_idx on raw_items(collected_at desc);
create index if not exists decisions_pain_point_idx on decisions(pain_point_id, decided_at desc);
create index if not exists learning_suggestions_status_idx on learning_suggestions(status, evidence_count desc, created_at desc);
create index if not exists rule_exclusions_active_idx on rule_exclusions(active, kind, created_at desc);
create index if not exists filter_additions_active_idx on filter_additions(active, kind, added_at desc);
create index if not exists filter_additions_origin_idx on filter_additions(origin_pain_point_id, added_at desc);
create index if not exists watched_cafes_active_idx on watched_cafes(active, created_at);
create index if not exists review_apps_active_idx on review_apps(active, created_at);
create index if not exists raw_items_watched_idx on raw_items(watched, watched_cafe_id, collected_at desc);
create index if not exists raw_items_app_review_idx on raw_items(app_target_id, review_platform, collected_at desc);
create index if not exists raw_items_review_status_idx on raw_items(review_status, review_override, collected_at desc);
create index if not exists query_discoveries_pending_idx on query_discoveries(origin, approved_at, frequency desc);
create index if not exists industry_seeds_round_robin_idx on industry_seeds(done, created_at, id);
create index if not exists industry_seeds_active_section_idx on industry_seeds(active, section, done, ksic_code);
create index if not exists pain_points_embedding_idx on pain_points using hnsw (embedding vector_cosine_ops);
