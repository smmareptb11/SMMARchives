-- Ceneau publishes a 200 px reduction beside every picture, which the freeze
-- did not copy: a webcam lane went looking for the full image — some six
-- hundred kilobytes — to paint eighty pixels of strip.
--
-- Nullable and without a backfill: a replay built before this holds no
-- reduction, and a run that finds the picture still listed freezes one on its
-- next pass. Null is read as "draw the full image", never as a defect.
alter table webcam_image add column stored_thumb_path text;
