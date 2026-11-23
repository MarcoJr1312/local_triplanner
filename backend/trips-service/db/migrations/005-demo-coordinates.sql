-- Demo trip coordinates. The API trip context uses these to avoid a locations
-- call for every suggestion; auto-suggest then survives a locations outage.
UPDATE trips
   SET destination_lat = 43.6532,
       destination_lng = -79.3832
 WHERE id = 'demo-trip'
   AND (destination_lat IS NULL OR destination_lng IS NULL);
