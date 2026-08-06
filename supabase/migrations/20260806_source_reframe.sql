alter table review_apps
  add column if not exists category text not null default '미분류';

create index if not exists review_apps_category_active_idx on review_apps(category, active);

alter table run_configs alter column source_weights
  set default '{"appreview":85,"threads":0,"hn":15,"blog":0,"kin":0,"cafearticle":0,"webkr":0}'::jsonb;
