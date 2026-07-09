-- ============================================================
-- 00057_seed_math_course.sql
-- Starter content: a "BME" org + a "Matek felkészítő" course built for
-- the BME mérnökinformatikus Analízis 1 (Matematika A1a / Kalkulus)
-- subject. Curated around the free BME "Matematika 1" jegyzet and the
-- recommended Thomas-féle Kalkulus, with an ordered study path (the
-- de-facto roadmap, since the app's interactive roadmaps are client-side
-- and can't be seeded server-side). Owned by the earliest profile (the
-- operator). Guarded on the BME name so a re-run won't duplicate.
-- `official` is forced false by the protect trigger — cosmetic only.
-- ============================================================

do $$
declare
  v_owner uuid;
  v_bme   uuid;
  v_math  uuid;
begin
  select id into v_owner from public.profiles order by created_at asc limit 1;
  if v_owner is null then
    return;
  end if;

  if exists (select 1 from public.spaces where lower(name) = 'bme' and parent_id is null) then
    return;
  end if;

  insert into public.spaces (owner_id, parent_id, kind, name, slug, description, visibility)
  values (
    v_owner, null, 'org', 'BME', 'bme',
    'Budapesti Műszaki és Gazdaságtudományi Egyetem — közösségi tér a kurzusokhoz.',
    'public'
  )
  returning id into v_bme;

  insert into public.spaces (owner_id, parent_id, kind, name, slug, description, visibility)
  values (
    v_owner, v_bme, 'course', 'Matek felkészítő — Analízis 1', 'matek-felkeszito',
    'Felkészítő kurzus a BME mérnökinformatikus Analízis 1 (Matematika A1a / Kalkulus) tárgyhoz. Fő tananyag a BME ingyenes Matematika 1 jegyzete és a Thomas-féle Kalkulus. Haladási terv (roadmap): 1) valós számok, sorozatok, határérték → 2) függvények, folytonosság, deriválás → 3) integrálás → 4) sorozatok és sorok. Az alábbi anyagok ebben a sorrendben építik fel a tudást.',
    'public'
  )
  returning id into v_math;

  -- ordered study path = the roadmap (sort_order = week/topic order)
  insert into public.space_content (space_id, kind, title, url, subtitle, added_by, sort_order)
  values
    (v_math, 'book', 'Matematika 1 — BME jegyzet (Fritz–Kónya–Pataki–Tasnádi)',
      'http://tankonyvtar.ttk.bme.hu/pdf/8.pdf',
      'Ingyenes fő tankönyv — nyisd meg a forrást, vagy töltsd fel a saját példányod', v_owner, 0),
    (v_math, 'book', 'Thomas-féle Kalkulus (Analízis 1)',
      'https://www.typotex.hu/book/1304/thomas_weir_hass_giordano_thomas_fele_kalkulus_1',
      'A VIK által ajánlott tankönyv — nyisd meg a forrást, vagy töltsd fel a saját PDF-ed', v_owner, 1),
    (v_math, 'link', 'VIK Wiki — Matematika A1a Analízis',
      'https://vik.wiki/Matematika_A1a_-_Anal%C3%ADzis',
      'Követelmények, korábbi ZH-k és vizsgák, gyakorlati tippek', v_owner, 2),
    (v_math, 'link', 'Kalkulus ütemterv (BME Geometria Tsz.)',
      'https://geometria.math.bme.hu/node/3034',
      'A féléves haladási terv, amit a roadmap követ', v_owner, 3),
    (v_math, 'link', '3Blue1Brown — Essence of Calculus',
      'https://www.youtube.com/playlist?list=PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr',
      'Vizuális intuíció a deriválthoz, integrálhoz és a sorokhoz', v_owner, 4),
    (v_math, 'link', 'Khan Academy — Calculus 1',
      'https://www.khanacademy.org/math/calculus-1',
      'Extra gyakorlás lépésről lépésre, önteszttel', v_owner, 5);

  insert into public.offerings (space_id, term_label, status, sort_order)
  values (v_math, '2025 ősz', 'active', 0);
end $$;
