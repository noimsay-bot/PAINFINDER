alter table run_configs
  add column if not exists auto_verify_top_n integer not null default 10;

alter table run_configs
  drop constraint if exists run_configs_auto_verify_top_n_check;
alter table run_configs
  add constraint run_configs_auto_verify_top_n_check check (auto_verify_top_n between 0 and 40);

alter table raw_items
  add column if not exists reject_reason text;

alter table pain_points
  add column if not exists precision_verified_at timestamptz;

alter table competitors
  add column if not exists seller_name text,
  add column if not exists source text not null default 'web';

alter table scores alter column f2 drop not null;
alter table scores alter column f3 drop not null;

alter table scores drop constraint if exists scores_f4_check;
alter table scores drop constraint if exists scores_f5_check;
alter table scores add constraint scores_f4_check check (f4 between 0 and 3);
alter table scores add constraint scores_f5_check check (f5 between 0 and 3);

alter table scores drop column if exists total;
alter table scores add column total smallint generated always as (
  f1 + coalesce(f2, 0) + coalesce(f3, 0) + f4 + f5 + f6
) stored;
