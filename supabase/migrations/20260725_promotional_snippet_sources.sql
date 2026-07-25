alter table run_configs
  add column if not exists source_weights jsonb not null
    default '{"kin":35,"blog":30,"cafearticle":35,"webkr":0}'::jsonb;

alter table raw_items
  add column if not exists raw_payload jsonb,
  add column if not exists source_name text,
  add column if not exists author_name text,
  add column if not exists body_length integer not null default 0,
  add column if not exists low_confidence boolean not null default false,
  add column if not exists promotional_signals jsonb not null default '[]'::jsonb,
  add column if not exists promotional_signal_score integer not null default 0,
  add column if not exists promotional_rule_flagged boolean not null default false,
  add column if not exists is_promotional boolean not null default false,
  add column if not exists highlight_terms jsonb not null default '[]'::jsonb;

update raw_items
set
  body_length = char_length(body),
  low_confidence = char_length(body) < 40
where body_length = 0;

alter table raw_items
  drop constraint if exists raw_items_body_length_check,
  add constraint raw_items_body_length_check check (body_length >= 0),
  drop constraint if exists raw_items_promotional_signal_score_check,
  add constraint raw_items_promotional_signal_score_check check (promotional_signal_score >= 0);

alter table learning_suggestions
  drop constraint if exists learning_suggestions_suggestion_type_check;

alter table learning_suggestions
  add constraint learning_suggestions_suggestion_type_check
  check (suggestion_type in ('keyword','promotional_keyword','domain','prompt_example'));

create index if not exists raw_items_source_body_length_idx
  on raw_items(source, body_length desc);

create index if not exists raw_items_promotional_idx
  on raw_items(is_promotional, collected_at desc);
