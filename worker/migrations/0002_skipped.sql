-- Epizoda označená „Nechci přehrát“
ALTER TABLE episode_state ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;
