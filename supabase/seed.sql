-- Development taxonomy only. No real users, media, or fabricated account activity.
insert into public.genres(slug,label) values
('fantasy','Fantasy'),('sci-fi','Sci-Fi'),('comedy','Comedy'),('horror','Horror'),
('animals','Animals'),('action','Action'),('romance','Romance'),('mystery','Mystery'),
('anime','Anime'),('history','History'),('nature','Nature'),('wholesome','Wholesome')
on conflict(slug) do update set label=excluded.label;
insert into public.content_regions(slug,label) values
('korean','Korean'),('chinese','Chinese'),('filipino','Filipino'),('japanese','Japanese'),
('indian','Indian'),('thai','Thai'),('vietnamese','Vietnamese'),('turkish','Turkish'),
('american','American'),('british','British'),('mexican','Mexican'),('global','Global / Any')
on conflict(slug) do update set label=excluded.label;
