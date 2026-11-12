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
  -- The basin union the extent was framed on. Null when no union names it.
  territory     text,
  -- What the administrator said of it on constituting it, each optional and
  -- never written by a build.
  description   text,
  phenomenon    text,
  severity      text,
  period_from   timestamptz not null,
  period_to     timestamptz not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  state         text not null,
  -- Set by the one build that goes into this replay, in the statement that
  -- checks no other did: a replay is built once.
  build_claimed_at timestamptz,
  -- Null until an administrator publishes the replay, which only a complete
  -- one can be. A build never writes it.
  published_at  timestamptz,
  journal_error text,
  -- The tally of a copy, which no count over the tables retrieves: what failed
  -- never became a row.
  media_copied  integer not null default 0,
  media_failed  integer not null default 0,
  media_bytes   bigint  not null default 0,
  -- The fleet a replay rests on, per family, as the lane that collected it
  -- counted it.
  fleet         jsonb,
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
  -- reader revalidates against: an agent changes the events in place, and
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

-- The primary key *is* the rule that a measure has no duplicate: two readings
-- of one source, one quantity and one instant are the same reading, and the
-- collection keeps the first before anything reaches this table. The family is
-- part of it: the two Aquasys families number their sources independently, so
-- `source_id` 4 names a station and a rain gauge.
create table measure (
  replay_id uuid not null references replay on delete cascade,
  family    text not null,
  source_id text not null,
  quantity  text not null,
  at        timestamptz not null,
  value     double precision not null,
  primary key (replay_id, family, source_id, quantity, at)
);

create table measured_station (
  replay_id  uuid not null references replay on delete cascade,
  station_id text not null,
  primary key (replay_id, station_id)
);

create table event (
  replay_id     uuid not null references replay on delete cascade,
  -- Minted here for an agent's event; a derivation supplies its own.
  id            text not null default gen_random_uuid()::text,
  origin        text not null,
  category      text not null,
  title         text not null,
  description   text,
  -- What kind of producer reported it, in the agent's own words: an SMMAR
  -- agent, a river syndicate, a commune, the SDIS, a resident.
  producer_kind text,
  link          text,
  severity      integer,
  color         text,
  starts_at     timestamptz not null,
  -- Null is a point in time; a value means it stayed active until then.
  ends_at       timestamptz,
  -- A point or an area: a flooded field is not a spot.
  position      geometry(Geometry, 4326),
  -- A station of the hydro fleet, with no family beside it: only a crossing
  -- names a source, and a crossing joins that fleet alone.
  source_id     text,
  media         text[] not null default '{}',
  crossing      jsonb,
  primary key (replay_id, id)
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
  -- The reduction Ceneau publishes beside the picture, which a lane draws
  -- instead of the full image. Null is read as "draw the full image", never as
  -- a defect: Ceneau does not always publish one.
  stored_thumb_path text,
  primary key (replay_id, code, at)
);

create table radar_series (
  replay_id           uuid not null references replay on delete cascade,
  delivery            text not null,
  product             text not null,
  -- A property of the series, not of one frame.
  median_step_minutes double precision,
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

-- One row per signed-in browser. The token stays in the cookie: what is kept
-- is its digest keyed by the session secret, so a copy of this table opens
-- nothing.
create table session (
  digest     text primary key,
  expires_at timestamptz not null
);
