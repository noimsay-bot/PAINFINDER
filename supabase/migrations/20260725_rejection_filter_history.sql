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

alter table filter_additions enable row level security;

create index if not exists filter_additions_active_idx
  on filter_additions(active, kind, added_at desc);

create index if not exists filter_additions_origin_idx
  on filter_additions(origin_pain_point_id, added_at desc);

