-- Demo trip wall times are Toronto times. Existing volumes were created with
-- the schema default (UTC), which made reminder notifications display five
-- hours off. Only the demo trip is corrected; real trips keep their setting.
UPDATE trips
   SET timezone = 'America/Toronto'
 WHERE id = 'demo-trip' AND timezone = 'UTC';
