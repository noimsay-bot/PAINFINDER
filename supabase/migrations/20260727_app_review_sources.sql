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
create index if not exists review_apps_active_idx on review_apps(active, created_at);

alter table raw_items add column if not exists app_target_id bigint references review_apps(id) on delete set null;
alter table raw_items add column if not exists app_name text;
alter table raw_items add column if not exists review_platform text check (review_platform in ('ios','android'));
alter table raw_items add column if not exists review_score smallint check (review_score between 1 and 5);
alter table raw_items add column if not exists app_version text;
alter table raw_items add column if not exists incumbent_dissatisfaction boolean not null default false;

create index if not exists raw_items_app_review_idx on raw_items(app_target_id, review_platform, collected_at desc);
alter table review_apps enable row level security;

alter table run_configs alter column source_weights set default '{"appreview":40,"blog":20,"kin":10,"cafearticle":15,"threads":15,"webkr":0}'::jsonb;
