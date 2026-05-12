UPDATE memory_events SET time_text = '未提到时间' WHERE time_text IS NULL;
ALTER TABLE memory_events ALTER COLUMN time_text SET NOT NULL;
