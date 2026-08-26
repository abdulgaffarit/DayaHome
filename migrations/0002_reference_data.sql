-- ============================================================================
-- Reference data: categories, locations, amenities, platform settings.
--
-- This is NOT development seed data — every environment needs these rows.
-- Development-only sample listings live in `scripts/seed.ts`.
-- Ids are deterministic (`cat_*`, `loc_*`, `amn_*`) so the seed script and any
-- future migration can reference them without a lookup.
-- ============================================================================

INSERT INTO categories (id, slug, name_bn, name_en, kind, sort_order, is_active, created_at, updated_at) VALUES
  ('cat_basha_vhara',  'basha-vhara',  'বাসা ভাড়া',   'House rental',  'RENT', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat_basha_bikri',  'basha-bikri',  'বাসা বিক্রি',  'House sale',    'SALE', 2, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat_dokaan_vhara', 'dokaan-vhara', 'দোকান ভাড়া',  'Shop rental',   'RENT', 3, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat_office_vhara', 'office-vhara', 'অফিস ভাড়া',   'Office rental', 'RENT', 4, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat_godown_vhara', 'godown-vhara', 'গুদাম ভাড়া',  'Godown rental', 'RENT', 5, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat_jomi_bikri',   'jomi-bikri',   'জমি বিক্রি',   'Land sale',     'SALE', 6, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat_jomi_vhara',   'jomi-vhara',   'জমি ভাড়া',    'Land rental',   'RENT', 7, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat_mess',         'mess',         'মেস',         'Mess',          'RENT', 8, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('cat_sublet',       'sublet',       'সাবলেট',      'Sublet',        'RENT', 9, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

-- Dayarampur union (Bagatipara upazila, Natore) and its neighbourhoods.
INSERT INTO locations (id, slug, name_bn, name_en, parent_id, sort_order, is_active, created_at, updated_at) VALUES
  ('loc_dayarampur', 'dayarampur', 'দয়ারামপুর', 'Dayarampur', NULL, 0, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT INTO locations (id, slug, name_bn, name_en, parent_id, sort_order, is_active, created_at, updated_at) VALUES
  ('loc_bazar',        'dayarampur-bazar',   'দয়ারামপুর বাজার',   'Dayarampur Bazar',   'loc_dayarampur', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_cantonment',   'cantonment-area',    'ক্যান্টনমেন্ট এলাকা', 'Cantonment Area',    'loc_dayarampur', 2, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_college_road', 'college-road',       'কলেজ রোড',          'College Road',       'loc_dayarampur', 3, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_school_para',  'school-para',        'স্কুল পাড়া',        'School Para',        'loc_dayarampur', 4, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_station_road', 'station-road',       'স্টেশন রোড',        'Station Road',       'loc_dayarampur', 5, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_hospital',     'hospital-para',      'হাসপাতাল পাড়া',    'Hospital Para',      'loc_dayarampur', 6, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_malanchi',     'malanchi',           'মালঞ্চি',           'Malanchi',           'loc_dayarampur', 7, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_tamaltala',    'tamaltala',          'তমালতলা',           'Tamaltala',          'loc_dayarampur', 8, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_purbo_para',   'purbo-para',         'পূর্ব পাড়া',        'Purbo Para',         'loc_dayarampur', 9, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('loc_poschim_para', 'poschim-para',       'পশ্চিম পাড়া',       'Poschim Para',       'loc_dayarampur', 10, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT INTO amenities (id, slug, name_bn, icon, sort_order) VALUES
  ('amn_gas',        'gas',          'গ্যাস সংযোগ',        'flame',        1),
  ('amn_water',      'water',        'পানির সরবরাহ',      'droplets',     2),
  ('amn_electric',   'electricity',  'বিদ্যুৎ',            'zap',          3),
  ('amn_generator',  'generator',    'জেনারেটর/আইপিএস',   'battery-charging', 4),
  ('amn_lift',       'lift',         'লিফট',              'move-vertical', 5),
  ('amn_parking',    'parking',      'গাড়ি পার্কিং',      'car',          6),
  ('amn_balcony',    'balcony',      'বারান্দা',           'panel-top',    7),
  ('amn_security',   'security',     'নিরাপত্তা প্রহরী',   'shield-check', 8),
  ('amn_cctv',       'cctv',         'সিসিটিভি',          'cctv',         9),
  ('amn_tank',       'tank',         'পানির ট্যাংক',      'container',    10),
  ('amn_wifi',       'wifi',         'ইন্টারনেট/ওয়াইফাই', 'wifi',         11),
  ('amn_furnished',  'furniture',    'আসবাবপত্র',         'sofa',         12),
  ('amn_kitchen',    'kitchen',      'আলাদা রান্নাঘর',    'cooking-pot',  13),
  ('amn_roof',       'roof-access',  'ছাদ ব্যবহারের সুযোগ', 'layers',     14),
  ('amn_mosque',     'near-mosque',  'মসজিদ কাছে',        'landmark',     15),
  ('amn_market',     'near-market',  'বাজার কাছে',        'shopping-bag', 16),
  ('amn_school',     'near-school',  'স্কুল কাছে',        'graduation-cap', 17),
  ('amn_road',       'main-road',    'মেইন রোডের পাশে',   'route',        18);

INSERT INTO settings (key, value, description, updated_at) VALUES
  ('contact_unlock_price_bdt', '50',  'যোগাযোগের তথ্য আনলক করার মূল্য (টাকা)', '2026-01-01T00:00:00Z'),
  ('listing_duration_days',    '60',  'অনুমোদনের পর একটি বিজ্ঞাপন কত দিন সক্রিয় থাকবে', '2026-01-01T00:00:00Z'),
  ('max_images_per_property',  '15',  'প্রতি বিজ্ঞাপনে সর্বোচ্চ ছবির সংখ্যা', '2026-01-01T00:00:00Z'),
  ('auto_approve_listings',    'false', 'নতুন বিজ্ঞাপন স্বয়ংক্রিয়ভাবে অনুমোদিত হবে কি না', '2026-01-01T00:00:00Z'),
  ('support_phone',            '01700000000', 'সহায়তা নম্বর (ফুটারে দেখানো হয়)', '2026-01-01T00:00:00Z'),
  ('support_email',            'support@dayarampur.com', 'সহায়তা ইমেইল', '2026-01-01T00:00:00Z');
