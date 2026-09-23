-- Everything a replay holds, except the bytes of its media, which live on the
-- volume. Columns are text rather than enumerated types: the port receives only
-- values already checked against their contract, and a shared contract must not
-- pay a migration for each value it gains.

create extension if not exists postgis;

create table replay (
  id            uuid primary key default gen_random_uuid(),
  label         text,
  -- Null is the whole SMMAR fleet, which is the territory's own extent.
  extent        geometry(Polygon, 4326),
  period_from   timestamptz not null,
  period_to     timestamptz not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  state         text not null,
  journal_error text,
  -- The tally of a copy, which no count over the tables retrieves: what was
  -- skipped and what failed never became a row.
  media_copied  integer not null default 0,
  media_skipped integer not null default 0,
  media_failed  integer not null default 0,
  media_bytes   bigint  not null default 0,
  -- The fleet a replay rests on. `with_measures` is the one count no query
  -- retrieves: it is summed per family by the lane that collected it, and a
  -- measure does not carry the family that would let it be recounted here.
  fleet_in_extent     integer,
  fleet_with_measures integer,
  check (period_from < period_to)
);

create table replay_lane (
  replay_id   uuid not null references replay on delete cascade,
  name        text not null,
  state       text not null,
  started_at  timestamptz,
  finished_at timestamptz,
  error       text,
  primary key (replay_id, name)
);

create table replay_dataset (
  replay_id  uuid not null references replay on delete cascade,
  name       text not null,
  report     jsonb not null,
  -- When its rows were last written, which is the material of the ETag a
  -- reader revalidates against: a re-run rewrites a data set in place, and
  -- nothing about the rows themselves says that it did.
  updated_at timestamptz not null default now(),
  primary key (replay_id, name)
);

create table replay_journal (
  replay_id uuid not null references replay on delete cascade,
  -- Per replay, and dense: it is what `?since=` and `Last-Event-ID` resume on.
  line      integer not null,
  at        timestamptz not null,
  lane      text not null,
  kind      text not null,
  message   text,
  primary key (replay_id, line)
);

-- The key is the triplet: Aquasys numbers each family independently, so the
-- number 4 names a station *and* a rain gauge. A key that forgot the family
-- would mix a water level with a rainfall, and the result would still read.
create table source (
  replay_id            uuid not null references replay on delete cascade,
  family               text not null,
  external_id          text not null,
  code                 text,
  -- A webcam has none: it is named by its commune, which is not a name.
  name                 text,
  comment              text,
  town_code            text,
  category             text,
  -- True when the category was assumed rather than read from the frozen table.
  category_is_fallback boolean,
  altitude             double precision,
  position             geometry(Point, 4326),
  quantities           jsonb,
  -- What one family has and the others do not: a webcam's commune, its url and
  -- whether it is operational. Columns would be null on every other row.
  extra                jsonb,
  primary key (replay_id, family, external_id)
);

create table threshold (
  replay_id          uuid not null references replay on delete cascade,
  station_id         text not null,
  -- A threshold's identifier is unique within a station *and* a quantity.
  quantity           text not null,
  threshold_id       integer not null,
  label              text not null,
  value              double precision not null,
  nature             text not null,
  nature_is_fallback boolean not null,
  color              text,
  primary key (replay_id, station_id, quantity, threshold_id)
);

-- The primary key *is* the rule that a re-run creates no duplicate: two
-- readings of one source, one quantity and one instant are the same reading,
-- and the second overwrites the first instead of adding to it.
--
-- No family here, because a measure does not carry one: the two Aquasys
-- families number their sources independently, and what keeps `source_id` 4 on
-- a station apart from `source_id` 4 on a rain gauge is that no quantity is
-- collected on both. The rule, and the day it ends, are stated in
-- `replay/crossings.ts`; a column here would look like an answer this data
-- cannot give.
create table measure (
  replay_id uuid not null references replay on delete cascade,
  source_id text not null,
  quantity  text not null,
  at        timestamptz not null,
  value     double precision not null,
  primary key (replay_id, source_id, quantity, at)
);

create table event (
  replay_id uuid not null references replay on delete cascade,
  id        text not null,
  origin    text not null,
  category  text not null,
  title     text not null,
  severity  integer,
  color     text,
  starts_at timestamptz not null,
  -- Null is a point in time; a value means it stayed active until then.
  ends_at   timestamptz,
  position  geometry(Point, 4326),
  family    text,
  source_id text,
  media     text[] not null default '{}',
  crossing  jsonb,
  primary key (replay_id, id)
);

-- One row per feature rather than one document per layer: an extent is
-- simplified when it is served, not once and for all at import.
create table reference_feature (
  replay_id  uuid not null references replay on delete cascade,
  layer      text not null,
  ordinal    integer not null,
  properties jsonb not null,
  geom       geometry(Geometry, 4326),
  primary key (replay_id, layer, ordinal)
);

create table webcam_image (
  replay_id   uuid not null references replay on delete cascade,
  code        text not null,
  at          timestamptz not null,
  uri         text not null,
  thumb_uri   text,
  -- Where the copy lives, relative to the replay's media directory. Null when
  -- a run asked for no media, or when the fetch returned nothing.
  stored_path text,
  primary key (replay_id, code, at)
);

create table radar_series (
  replay_id           uuid not null references replay on delete cascade,
  delivery            text not null,
  product             text not null,
  -- A property of the series, not of one frame.
  median_step_minutes integer,
  primary key (replay_id, delivery, product)
);

create table radar_frame (
  replay_id uuid not null references replay on delete cascade,
  delivery  text not null,
  product   text not null,
  at        timestamptz not null,
  -- The address it came from, inside the delivery, never one computed from an
  -- instant: a raster's filename is a production time, not a slot.
  path      text not null,
  primary key (replay_id, delivery, product, at),
  foreign key (replay_id, delivery, product) references radar_series on delete cascade
);

create index measure_by_source on measure (replay_id, source_id, at);
create index event_by_start on event (replay_id, starts_at);
create index source_position on source using gist (position);
create index reference_feature_geom on reference_feature using gist (geom);
