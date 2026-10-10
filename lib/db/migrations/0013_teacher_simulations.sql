ALTER TABLE teacher_activity_events DROP CONSTRAINT IF EXISTS teacher_activity_events_type_check;
ALTER TABLE teacher_activity_events ADD CONSTRAINT teacher_activity_events_type_check CHECK(type IN ('attempt','support','advance','restart','complete','simulation'));
