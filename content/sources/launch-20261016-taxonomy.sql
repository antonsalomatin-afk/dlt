-- Proposed additive taxonomy only. Review before a separately authorized database operation.

-- Matches launch-20261016-taxonomy.json. Does not import, verify or activate questions.

BEGIN;

INSERT INTO "Category" ("id", "slug", "nameThai", "nameEnglish", "nameRussian", "sortOrder") VALUES
  ('5816ed40-1491-5d19-b4c5-f32f54c06834'::uuid, 'launch-road-position', 'Road position and maneuvers', 'Road position and maneuvers', 'Road position and maneuvers', 1000),
  ('6008dfe0-860c-57fd-ab48-23d8578f10e7'::uuid, 'launch-space-management', 'Space and hazard awareness', 'Space and hazard awareness', 'Space and hazard awareness', 1001),
  ('fcd17626-f610-570e-b018-9b03ac157489'::uuid, 'launch-vulnerable-road-users', 'Sharing with vulnerable road users', 'Sharing with vulnerable road users', 'Sharing with vulnerable road users', 1002),
  ('cb3e4932-e775-520d-a2d3-44d6634296bb'::uuid, 'launch-speed-and-weather', 'Speed and weather', 'Speed and weather', 'Speed and weather', 1003),
  ('6ac48c73-dfac-5145-a3cc-472c2ae502eb'::uuid, 'launch-visibility', 'Visibility and lighting', 'Visibility and lighting', 'Visibility and lighting', 1004),
  ('9ed885fa-4820-54cf-8fde-29829417b853'::uuid, 'launch-driver-fitness', 'Driver fitness and attention', 'Driver fitness and attention', 'Driver fitness and attention', 1005),
  ('3119d555-458c-50ec-8c08-437db4c7caf1'::uuid, 'launch-road-etiquette', 'Road etiquette', 'Road etiquette', 'Road etiquette', 1006),
  ('567a5cdc-ac93-5b7c-8e30-ededd7f99365'::uuid, 'launch-traffic-controls', 'Traffic controls', 'Traffic controls', 'Traffic controls', 1007),
  ('5b8d696f-6bf7-584c-962d-6e6128589593'::uuid, 'launch-parking', 'Stopping and parking', 'Stopping and parking', 'Stopping and parking', 1008),
  ('91c4b2e7-3ca9-5962-85ef-a02db939a97d'::uuid, 'launch-vehicle-readiness', 'Vehicle readiness', 'Vehicle readiness', 'Vehicle readiness', 1009),
  ('3920602a-8b8d-591b-bd40-02b708cef8a8'::uuid, 'launch-emergencies', 'Breakdowns and emergencies', 'Breakdowns and emergencies', 'Breakdowns and emergencies', 1010),
  ('b9b0427a-47a3-5cea-bb1b-01c885982bbc'::uuid, 'launch-motorcycle-surfaces', 'Motorcycle road surfaces', 'Motorcycle road surfaces', 'Motorcycle road surfaces', 1011)
ON CONFLICT DO NOTHING;

DO $taxonomy_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('5816ed40-1491-5d19-b4c5-f32f54c06834'::uuid, 'launch-road-position', 'Road position and maneuvers', 'Road position and maneuvers', 'Road position and maneuvers', 1000),
  ('6008dfe0-860c-57fd-ab48-23d8578f10e7'::uuid, 'launch-space-management', 'Space and hazard awareness', 'Space and hazard awareness', 'Space and hazard awareness', 1001),
  ('fcd17626-f610-570e-b018-9b03ac157489'::uuid, 'launch-vulnerable-road-users', 'Sharing with vulnerable road users', 'Sharing with vulnerable road users', 'Sharing with vulnerable road users', 1002),
  ('cb3e4932-e775-520d-a2d3-44d6634296bb'::uuid, 'launch-speed-and-weather', 'Speed and weather', 'Speed and weather', 'Speed and weather', 1003),
  ('6ac48c73-dfac-5145-a3cc-472c2ae502eb'::uuid, 'launch-visibility', 'Visibility and lighting', 'Visibility and lighting', 'Visibility and lighting', 1004),
  ('9ed885fa-4820-54cf-8fde-29829417b853'::uuid, 'launch-driver-fitness', 'Driver fitness and attention', 'Driver fitness and attention', 'Driver fitness and attention', 1005),
  ('3119d555-458c-50ec-8c08-437db4c7caf1'::uuid, 'launch-road-etiquette', 'Road etiquette', 'Road etiquette', 'Road etiquette', 1006),
  ('567a5cdc-ac93-5b7c-8e30-ededd7f99365'::uuid, 'launch-traffic-controls', 'Traffic controls', 'Traffic controls', 'Traffic controls', 1007),
  ('5b8d696f-6bf7-584c-962d-6e6128589593'::uuid, 'launch-parking', 'Stopping and parking', 'Stopping and parking', 'Stopping and parking', 1008),
  ('91c4b2e7-3ca9-5962-85ef-a02db939a97d'::uuid, 'launch-vehicle-readiness', 'Vehicle readiness', 'Vehicle readiness', 'Vehicle readiness', 1009),
  ('3920602a-8b8d-591b-bd40-02b708cef8a8'::uuid, 'launch-emergencies', 'Breakdowns and emergencies', 'Breakdowns and emergencies', 'Breakdowns and emergencies', 1010),
  ('b9b0427a-47a3-5cea-bb1b-01c885982bbc'::uuid, 'launch-motorcycle-surfaces', 'Motorcycle road surfaces', 'Motorcycle road surfaces', 'Motorcycle road surfaces', 1011)
    ) AS expected ("id", "slug", "nameThai", "nameEnglish", "nameRussian", "sortOrder")
    LEFT JOIN "Category" AS actual ON actual."id" = expected."id" AND actual."slug" = expected."slug" AND actual."nameThai" = expected."nameThai" AND actual."nameEnglish" = expected."nameEnglish" AND actual."nameRussian" = expected."nameRussian" AND actual."sortOrder" = expected."sortOrder"
    WHERE actual."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Launch taxonomy conflict: Category; transaction must roll back.';
  END IF;
END
$taxonomy_check$;

INSERT INTO "Concept" ("id", "slug", "nameThai", "nameEnglish", "nameRussian") VALUES
  ('17a8ea6b-f289-5442-bb70-c931f58c08c5'::uuid, 'launch-keep-left', 'Keep left', 'Keep left', 'Keep left'),
  ('1852555f-4997-5e43-a6f4-68247bccf2e3'::uuid, 'launch-signal-lane-change', 'Signal lane change', 'Signal lane change', 'Signal lane change'),
  ('492de757-6a30-507c-9109-522393a9d2fa'::uuid, 'launch-following-distance', 'Following distance', 'Following distance', 'Following distance'),
  ('9c2aebbc-cf5b-5c20-b6c3-617ef102fee8'::uuid, 'launch-school-area-caution', 'School area caution', 'School area caution', 'School area caution'),
  ('89d2a254-1f25-59ae-984b-aeec7787ace0'::uuid, 'launch-condition-appropriate-speed', 'Condition appropriate speed', 'Condition appropriate speed', 'Condition appropriate speed'),
  ('a0bc1de5-df8b-5b74-abf4-0fd6f4133ff2'::uuid, 'launch-blind-spot-check', 'Blind spot check', 'Blind spot check', 'Blind spot check'),
  ('8def9623-74f5-5cca-9481-a52fcd6afa08'::uuid, 'launch-truck-blind-spots', 'Truck blind spots', 'Truck blind spots', 'Truck blind spots'),
  ('064c4f3a-cc25-5885-baf4-342cc5309da0'::uuid, 'launch-truck-turning-clearance', 'Truck turning clearance', 'Truck turning clearance', 'Truck turning clearance'),
  ('2dbaddfc-9068-5463-887c-0a261fbe3093'::uuid, 'launch-truck-front-clearance', 'Truck front clearance', 'Truck front clearance', 'Truck front clearance'),
  ('f090e116-619e-5518-aba0-e76f1a46ea42'::uuid, 'launch-night-headlights', 'Night headlights', 'Night headlights', 'Night headlights'),
  ('cf565350-542c-5620-9aa9-ab9f4d8ce836'::uuid, 'launch-avoid-high-beam-glare', 'Avoid high beam glare', 'Avoid high beam glare', 'Avoid high beam glare'),
  ('342196ad-1c3d-5670-86d3-d703b62b4538'::uuid, 'launch-rain-smooth-braking', 'Rain smooth braking', 'Rain smooth braking', 'Rain smooth braking'),
  ('1b06ca92-bef3-5078-accb-2930e5c68e2e'::uuid, 'launch-rain-light-signals', 'Rain light signals', 'Rain light signals', 'Rain light signals'),
  ('fd42057a-5d25-5b0f-98b6-9f584bebcc8c'::uuid, 'launch-curve-control', 'Curve control', 'Curve control', 'Curve control'),
  ('79e65e1e-40dd-59f3-8619-f7619e98fce0'::uuid, 'launch-phone-safe-stop', 'Phone safe stop', 'Phone safe stop', 'Phone safe stop'),
  ('1680245e-2a49-563e-8d18-5bc8e7874c08'::uuid, 'launch-avoid-alcohol-driving', 'Avoid alcohol driving', 'Avoid alcohol driving', 'Avoid alcohol driving'),
  ('7720e98e-ec62-5421-bc61-442f168f2411'::uuid, 'launch-drowsy-medication', 'Drowsy medication', 'Drowsy medication', 'Drowsy medication'),
  ('5ab6d839-41ed-536d-975e-1812c020bdf6'::uuid, 'launch-sidewalk-pedestrians', 'Sidewalk pedestrians', 'Sidewalk pedestrians', 'Sidewalk pedestrians'),
  ('9fc5c7c1-1834-57d3-9d77-da226da7a198'::uuid, 'launch-shoulder-no-shortcut', 'Shoulder no shortcut', 'Shoulder no shortcut', 'Shoulder no shortcut'),
  ('90f2d0dd-3a16-5e83-a4c8-53e916e5c448'::uuid, 'launch-lane-discipline', 'Lane discipline', 'Lane discipline', 'Lane discipline'),
  ('e912c43d-b380-5627-8f8f-997fa8be3b61'::uuid, 'launch-horn-warning', 'Horn warning', 'Horn warning', 'Horn warning'),
  ('28be29ae-1246-51cb-8b39-cf87def20806'::uuid, 'launch-narrow-road-oncoming', 'Narrow road oncoming', 'Narrow road oncoming', 'Narrow road oncoming'),
  ('5a9b3210-ebfd-5cf3-988e-b1cc38b2793b'::uuid, 'launch-red-signal-stop', 'Red signal stop', 'Red signal stop', 'Red signal stop'),
  ('23e6185d-5095-5d0b-9123-dda924159d19'::uuid, 'launch-yellow-signal-prepare-stop', 'Yellow signal prepare stop', 'Yellow signal prepare stop', 'Yellow signal prepare stop'),
  ('b5a24f53-aa19-5232-a6b9-eb8437227ec9'::uuid, 'launch-roundabout-yield', 'Roundabout yield', 'Roundabout yield', 'Roundabout yield'),
  ('6b91e0c0-d694-5ebe-a127-984dfa643537'::uuid, 'launch-roundabout-path', 'Roundabout path', 'Roundabout path', 'Roundabout path'),
  ('fa2f1a9a-b697-5c90-a59f-5eae909fc5c9'::uuid, 'launch-pedestrian-yield', 'Pedestrian yield', 'Pedestrian yield', 'Pedestrian yield'),
  ('af79fa25-f911-5cf5-b9ea-ea1ea1b0c0b2'::uuid, 'launch-crossing-no-parking', 'Crossing no parking', 'Crossing no parking', 'Crossing no parking'),
  ('0fb700d1-4741-505e-918a-491d9f60bdcf'::uuid, 'launch-entrance-no-blocking', 'Entrance no blocking', 'Entrance no blocking', 'Entrance no blocking'),
  ('85d925a1-b48e-5ffc-852c-9550726ad026'::uuid, 'launch-emergency-vehicle-yield', 'Emergency vehicle yield', 'Emergency vehicle yield', 'Emergency vehicle yield'),
  ('3527c86d-c9a6-5594-aea1-0a92c2adbe62'::uuid, 'launch-railway-train-stop', 'Railway train stop', 'Railway train stop', 'Railway train stop'),
  ('68b74fc9-0c4e-57ab-b4a2-583f190ddb6f'::uuid, 'launch-railway-uncontrolled-check', 'Railway uncontrolled check', 'Railway uncontrolled check', 'Railway uncontrolled check'),
  ('ebacd9ae-99d4-5e0a-8136-695f4da34ee9'::uuid, 'launch-overtake-safe-gap', 'Overtake safe gap', 'Overtake safe gap', 'Overtake safe gap'),
  ('06998e77-aa4a-58c8-9196-49e98b208c75'::uuid, 'launch-allow-overtaking', 'Allow overtaking', 'Allow overtaking', 'Allow overtaking'),
  ('15c2de77-ac65-5f5b-a86a-d1f3e544f394'::uuid, 'launch-red-white-curb', 'Red white curb', 'Red white curb', 'Red white curb'),
  ('311fa21c-22d7-523e-8aa3-98c203079182'::uuid, 'launch-posted-speed-limit', 'Posted speed limit', 'Posted speed limit', 'Posted speed limit'),
  ('65944d29-6295-51fe-afc2-747014e5431e'::uuid, 'launch-seatbelt-every-trip', 'Seatbelt every trip', 'Seatbelt every trip', 'Seatbelt every trip'),
  ('29c6d05a-7bbb-5107-86df-e5b2bd500745'::uuid, 'launch-roadworthy-equipment', 'Roadworthy equipment', 'Roadworthy equipment', 'Roadworthy equipment'),
  ('29cf7e41-0e55-53d4-89fc-3711164d7913'::uuid, 'launch-rental-inspection', 'Rental inspection', 'Rental inspection', 'Rental inspection'),
  ('f7aaf769-0de5-57d9-b33c-488ef6216e5b'::uuid, 'launch-brake-light-check', 'Brake light check', 'Brake light check', 'Brake light check'),
  ('816c7edb-4e12-577e-84a4-a50bc55ddc63'::uuid, 'launch-breakdown-warning', 'Breakdown warning', 'Breakdown warning', 'Breakdown warning'),
  ('6fdecab8-35af-527b-8301-0abe21ad361f'::uuid, 'launch-planned-stop-mirrors', 'Planned stop mirrors', 'Planned stop mirrors', 'Planned stop mirrors'),
  ('ea6b91f8-2077-5d6f-8d92-249282585151'::uuid, 'launch-cyclist-at-entrance', 'Cyclist at entrance', 'Cyclist at entrance', 'Cyclist at entrance'),
  ('c77ffb6a-b8d0-5840-a6e7-c143a6e75210'::uuid, 'launch-right-lane-cooperation', 'Right lane cooperation', 'Right lane cooperation', 'Right lane cooperation'),
  ('d3893e32-7971-5b99-8afe-34f89232dea0'::uuid, 'launch-helmet-secure-all', 'Helmet secure all', 'Helmet secure all', 'Helmet secure all'),
  ('f87dcd99-3ee3-581c-9053-db2f42c50339'::uuid, 'launch-motorcycle-metal-plates', 'Motorcycle metal plates', 'Motorcycle metal plates', 'Motorcycle metal plates'),
  ('8d42307b-e9f4-5bb4-b560-0a7d6fe574d4'::uuid, 'launch-motorcycle-potholes', 'Motorcycle potholes', 'Motorcycle potholes', 'Motorcycle potholes'),
  ('a8e7cbcb-68b6-5c71-bd86-f97528587ced'::uuid, 'launch-motorcycle-oil-spill', 'Motorcycle oil spill', 'Motorcycle oil spill', 'Motorcycle oil spill'),
  ('52f296a1-6f62-5e70-b5fe-d2500d470d62'::uuid, 'launch-motorcycle-loose-surface', 'Motorcycle loose surface', 'Motorcycle loose surface', 'Motorcycle loose surface'),
  ('3d88c882-445e-5507-969f-876aa6cbe724'::uuid, 'launch-motorcycle-speed-bumps', 'Motorcycle speed bumps', 'Motorcycle speed bumps', 'Motorcycle speed bumps'),
  ('70e31f6c-63da-5994-ade2-1563380af755'::uuid, 'launch-motorcycle-no-cutting', 'Motorcycle no cutting', 'Motorcycle no cutting', 'Motorcycle no cutting'),
  ('3187b66d-03dc-511b-a1a1-28c4af10c6c2'::uuid, 'launch-motorcycle-heavy-rain', 'Motorcycle heavy rain', 'Motorcycle heavy rain', 'Motorcycle heavy rain'),
  ('662b8cac-b85f-5dc6-bdc4-e34c4e310933'::uuid, 'launch-keep-traffic-clear', 'Keep traffic clear', 'Keep traffic clear', 'Keep traffic clear')
ON CONFLICT DO NOTHING;

DO $taxonomy_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('17a8ea6b-f289-5442-bb70-c931f58c08c5'::uuid, 'launch-keep-left', 'Keep left', 'Keep left', 'Keep left'),
  ('1852555f-4997-5e43-a6f4-68247bccf2e3'::uuid, 'launch-signal-lane-change', 'Signal lane change', 'Signal lane change', 'Signal lane change'),
  ('492de757-6a30-507c-9109-522393a9d2fa'::uuid, 'launch-following-distance', 'Following distance', 'Following distance', 'Following distance'),
  ('9c2aebbc-cf5b-5c20-b6c3-617ef102fee8'::uuid, 'launch-school-area-caution', 'School area caution', 'School area caution', 'School area caution'),
  ('89d2a254-1f25-59ae-984b-aeec7787ace0'::uuid, 'launch-condition-appropriate-speed', 'Condition appropriate speed', 'Condition appropriate speed', 'Condition appropriate speed'),
  ('a0bc1de5-df8b-5b74-abf4-0fd6f4133ff2'::uuid, 'launch-blind-spot-check', 'Blind spot check', 'Blind spot check', 'Blind spot check'),
  ('8def9623-74f5-5cca-9481-a52fcd6afa08'::uuid, 'launch-truck-blind-spots', 'Truck blind spots', 'Truck blind spots', 'Truck blind spots'),
  ('064c4f3a-cc25-5885-baf4-342cc5309da0'::uuid, 'launch-truck-turning-clearance', 'Truck turning clearance', 'Truck turning clearance', 'Truck turning clearance'),
  ('2dbaddfc-9068-5463-887c-0a261fbe3093'::uuid, 'launch-truck-front-clearance', 'Truck front clearance', 'Truck front clearance', 'Truck front clearance'),
  ('f090e116-619e-5518-aba0-e76f1a46ea42'::uuid, 'launch-night-headlights', 'Night headlights', 'Night headlights', 'Night headlights'),
  ('cf565350-542c-5620-9aa9-ab9f4d8ce836'::uuid, 'launch-avoid-high-beam-glare', 'Avoid high beam glare', 'Avoid high beam glare', 'Avoid high beam glare'),
  ('342196ad-1c3d-5670-86d3-d703b62b4538'::uuid, 'launch-rain-smooth-braking', 'Rain smooth braking', 'Rain smooth braking', 'Rain smooth braking'),
  ('1b06ca92-bef3-5078-accb-2930e5c68e2e'::uuid, 'launch-rain-light-signals', 'Rain light signals', 'Rain light signals', 'Rain light signals'),
  ('fd42057a-5d25-5b0f-98b6-9f584bebcc8c'::uuid, 'launch-curve-control', 'Curve control', 'Curve control', 'Curve control'),
  ('79e65e1e-40dd-59f3-8619-f7619e98fce0'::uuid, 'launch-phone-safe-stop', 'Phone safe stop', 'Phone safe stop', 'Phone safe stop'),
  ('1680245e-2a49-563e-8d18-5bc8e7874c08'::uuid, 'launch-avoid-alcohol-driving', 'Avoid alcohol driving', 'Avoid alcohol driving', 'Avoid alcohol driving'),
  ('7720e98e-ec62-5421-bc61-442f168f2411'::uuid, 'launch-drowsy-medication', 'Drowsy medication', 'Drowsy medication', 'Drowsy medication'),
  ('5ab6d839-41ed-536d-975e-1812c020bdf6'::uuid, 'launch-sidewalk-pedestrians', 'Sidewalk pedestrians', 'Sidewalk pedestrians', 'Sidewalk pedestrians'),
  ('9fc5c7c1-1834-57d3-9d77-da226da7a198'::uuid, 'launch-shoulder-no-shortcut', 'Shoulder no shortcut', 'Shoulder no shortcut', 'Shoulder no shortcut'),
  ('90f2d0dd-3a16-5e83-a4c8-53e916e5c448'::uuid, 'launch-lane-discipline', 'Lane discipline', 'Lane discipline', 'Lane discipline'),
  ('e912c43d-b380-5627-8f8f-997fa8be3b61'::uuid, 'launch-horn-warning', 'Horn warning', 'Horn warning', 'Horn warning'),
  ('28be29ae-1246-51cb-8b39-cf87def20806'::uuid, 'launch-narrow-road-oncoming', 'Narrow road oncoming', 'Narrow road oncoming', 'Narrow road oncoming'),
  ('5a9b3210-ebfd-5cf3-988e-b1cc38b2793b'::uuid, 'launch-red-signal-stop', 'Red signal stop', 'Red signal stop', 'Red signal stop'),
  ('23e6185d-5095-5d0b-9123-dda924159d19'::uuid, 'launch-yellow-signal-prepare-stop', 'Yellow signal prepare stop', 'Yellow signal prepare stop', 'Yellow signal prepare stop'),
  ('b5a24f53-aa19-5232-a6b9-eb8437227ec9'::uuid, 'launch-roundabout-yield', 'Roundabout yield', 'Roundabout yield', 'Roundabout yield'),
  ('6b91e0c0-d694-5ebe-a127-984dfa643537'::uuid, 'launch-roundabout-path', 'Roundabout path', 'Roundabout path', 'Roundabout path'),
  ('fa2f1a9a-b697-5c90-a59f-5eae909fc5c9'::uuid, 'launch-pedestrian-yield', 'Pedestrian yield', 'Pedestrian yield', 'Pedestrian yield'),
  ('af79fa25-f911-5cf5-b9ea-ea1ea1b0c0b2'::uuid, 'launch-crossing-no-parking', 'Crossing no parking', 'Crossing no parking', 'Crossing no parking'),
  ('0fb700d1-4741-505e-918a-491d9f60bdcf'::uuid, 'launch-entrance-no-blocking', 'Entrance no blocking', 'Entrance no blocking', 'Entrance no blocking'),
  ('85d925a1-b48e-5ffc-852c-9550726ad026'::uuid, 'launch-emergency-vehicle-yield', 'Emergency vehicle yield', 'Emergency vehicle yield', 'Emergency vehicle yield'),
  ('3527c86d-c9a6-5594-aea1-0a92c2adbe62'::uuid, 'launch-railway-train-stop', 'Railway train stop', 'Railway train stop', 'Railway train stop'),
  ('68b74fc9-0c4e-57ab-b4a2-583f190ddb6f'::uuid, 'launch-railway-uncontrolled-check', 'Railway uncontrolled check', 'Railway uncontrolled check', 'Railway uncontrolled check'),
  ('ebacd9ae-99d4-5e0a-8136-695f4da34ee9'::uuid, 'launch-overtake-safe-gap', 'Overtake safe gap', 'Overtake safe gap', 'Overtake safe gap'),
  ('06998e77-aa4a-58c8-9196-49e98b208c75'::uuid, 'launch-allow-overtaking', 'Allow overtaking', 'Allow overtaking', 'Allow overtaking'),
  ('15c2de77-ac65-5f5b-a86a-d1f3e544f394'::uuid, 'launch-red-white-curb', 'Red white curb', 'Red white curb', 'Red white curb'),
  ('311fa21c-22d7-523e-8aa3-98c203079182'::uuid, 'launch-posted-speed-limit', 'Posted speed limit', 'Posted speed limit', 'Posted speed limit'),
  ('65944d29-6295-51fe-afc2-747014e5431e'::uuid, 'launch-seatbelt-every-trip', 'Seatbelt every trip', 'Seatbelt every trip', 'Seatbelt every trip'),
  ('29c6d05a-7bbb-5107-86df-e5b2bd500745'::uuid, 'launch-roadworthy-equipment', 'Roadworthy equipment', 'Roadworthy equipment', 'Roadworthy equipment'),
  ('29cf7e41-0e55-53d4-89fc-3711164d7913'::uuid, 'launch-rental-inspection', 'Rental inspection', 'Rental inspection', 'Rental inspection'),
  ('f7aaf769-0de5-57d9-b33c-488ef6216e5b'::uuid, 'launch-brake-light-check', 'Brake light check', 'Brake light check', 'Brake light check'),
  ('816c7edb-4e12-577e-84a4-a50bc55ddc63'::uuid, 'launch-breakdown-warning', 'Breakdown warning', 'Breakdown warning', 'Breakdown warning'),
  ('6fdecab8-35af-527b-8301-0abe21ad361f'::uuid, 'launch-planned-stop-mirrors', 'Planned stop mirrors', 'Planned stop mirrors', 'Planned stop mirrors'),
  ('ea6b91f8-2077-5d6f-8d92-249282585151'::uuid, 'launch-cyclist-at-entrance', 'Cyclist at entrance', 'Cyclist at entrance', 'Cyclist at entrance'),
  ('c77ffb6a-b8d0-5840-a6e7-c143a6e75210'::uuid, 'launch-right-lane-cooperation', 'Right lane cooperation', 'Right lane cooperation', 'Right lane cooperation'),
  ('d3893e32-7971-5b99-8afe-34f89232dea0'::uuid, 'launch-helmet-secure-all', 'Helmet secure all', 'Helmet secure all', 'Helmet secure all'),
  ('f87dcd99-3ee3-581c-9053-db2f42c50339'::uuid, 'launch-motorcycle-metal-plates', 'Motorcycle metal plates', 'Motorcycle metal plates', 'Motorcycle metal plates'),
  ('8d42307b-e9f4-5bb4-b560-0a7d6fe574d4'::uuid, 'launch-motorcycle-potholes', 'Motorcycle potholes', 'Motorcycle potholes', 'Motorcycle potholes'),
  ('a8e7cbcb-68b6-5c71-bd86-f97528587ced'::uuid, 'launch-motorcycle-oil-spill', 'Motorcycle oil spill', 'Motorcycle oil spill', 'Motorcycle oil spill'),
  ('52f296a1-6f62-5e70-b5fe-d2500d470d62'::uuid, 'launch-motorcycle-loose-surface', 'Motorcycle loose surface', 'Motorcycle loose surface', 'Motorcycle loose surface'),
  ('3d88c882-445e-5507-969f-876aa6cbe724'::uuid, 'launch-motorcycle-speed-bumps', 'Motorcycle speed bumps', 'Motorcycle speed bumps', 'Motorcycle speed bumps'),
  ('70e31f6c-63da-5994-ade2-1563380af755'::uuid, 'launch-motorcycle-no-cutting', 'Motorcycle no cutting', 'Motorcycle no cutting', 'Motorcycle no cutting'),
  ('3187b66d-03dc-511b-a1a1-28c4af10c6c2'::uuid, 'launch-motorcycle-heavy-rain', 'Motorcycle heavy rain', 'Motorcycle heavy rain', 'Motorcycle heavy rain'),
  ('662b8cac-b85f-5dc6-bdc4-e34c4e310933'::uuid, 'launch-keep-traffic-clear', 'Keep traffic clear', 'Keep traffic clear', 'Keep traffic clear')
    ) AS expected ("id", "slug", "nameThai", "nameEnglish", "nameRussian")
    LEFT JOIN "Concept" AS actual ON actual."id" = expected."id" AND actual."slug" = expected."slug" AND actual."nameThai" = expected."nameThai" AND actual."nameEnglish" = expected."nameEnglish" AND actual."nameRussian" = expected."nameRussian"
    WHERE actual."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Launch taxonomy conflict: Concept; transaction must roll back.';
  END IF;
END
$taxonomy_check$;

COMMIT;
