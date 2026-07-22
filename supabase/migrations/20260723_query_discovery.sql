alter table seed_queries add column if not exists origin text not null default 'manual';

alter table scores add column if not exists verified boolean not null default false;
alter table scores alter column f4 drop not null;
alter table scores drop column if exists total;
alter table scores add column total smallint generated always as (
  f1 + coalesce(f2, 0) + coalesce(f3, 0) + coalesce(f4, 0) + f5 + f6
) stored;

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

create index if not exists query_discoveries_pending_idx
  on query_discoveries(origin, approved_at, frequency desc);
create index if not exists industry_seeds_round_robin_idx
  on industry_seeds(done, created_at, id);
