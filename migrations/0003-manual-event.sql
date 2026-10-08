-- What an agent writes beside the title of an event, and who told them. Both
-- null on a derived event: a crossing describes itself through `crossing`, and
-- its provenance is the replay.
alter table event add column description text;
alter table event add column provenance text;
