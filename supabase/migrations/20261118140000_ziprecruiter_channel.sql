-- ZipRecruiter feed channel (plan/multiposting, spec section 10.6). A `feed`
-- channel like Jooble: companies opt in and we approve by hand. The XML is
-- served at /feeds/ziprecruiter.xml.
insert into public.distribution_channels (key, kind, name, requires_approval) values
  ('ziprecruiter', 'feed', 'ZipRecruiter', true)
on conflict (key) do nothing;
