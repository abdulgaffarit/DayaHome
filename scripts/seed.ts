/**
 * Development seed data for dayarampur.com.
 *
 * Emits SQL on stdout so it can be piped into any D1 target:
 *   npm run db:seed              (local D1)
 *   npm run db:seed:remote       (the environment's remote D1)
 *
 * Generating SQL rather than talking to D1 directly keeps the script runnable
 * with plain `tsx`, makes the output reviewable before it touches a database,
 * and means the same file works for local and remote.
 *
 * Everything here is obviously fake. Phone numbers all use the 01700-000xxx
 * reserved-looking block so no real person is ever called by a tester.
 */
import { createHash, randomBytes, pbkdf2Sync } from "node:crypto";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz";

/** Deterministic ids keep re-runs of the seed idempotent and diffable. */
function id(prefix: string, seed: string): string {
  const digest = createHash("sha256").update(`${prefix}:${seed}`).digest();
  let out = "";
  for (let i = 0; i < 16; i++) out += ALPHABET[digest[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Mirrors src/server/auth/password.ts so seeded users can actually log in. */
function hashPassword(password: string): string {
  const iterations = 150_000;
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2$sha-256$${iterations}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function sqlString(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Newline-safe string literal.
 *
 * SQLite string literals may span lines, but `wrangler d1 execute --file`
 * splits the input by statement using a line-oriented scan, so an embedded
 * newline silently truncates the statement. Emitting the value as a
 * `char(10)`-joined concatenation keeps every statement on exactly one line.
 */
function sqlText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  const parts = value.split("\n");
  if (parts.length === 1) return sqlString(value);
  return parts.map(sqlString).join(" || char(10) || ");
}

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isoFuture(daysAhead: number): string {
  return iso(-daysAhead);
}

function dateOnly(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

const lines: string[] = [];
const emit = (sql: string) => lines.push(sql);

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

const PASSWORD = "dayarampur123";

interface SeedUser {
  key: string;
  name: string;
  phone: string;
  email: string | null;
  role: "USER" | "OWNER" | "ADMIN" | "SUPER_ADMIN";
}

const USERS: SeedUser[] = [
  { key: "super", name: "সুপার অ্যাডমিন", phone: "01700000001", email: "super@dayarampur.test", role: "SUPER_ADMIN" },
  { key: "admin", name: "মোঃ রফিকুল ইসলাম", phone: "01700000002", email: "admin@dayarampur.test", role: "ADMIN" },
  { key: "owner1", name: "আব্দুল করিম", phone: "01700000101", email: null, role: "OWNER" },
  { key: "owner2", name: "শাহানা বেগম", phone: "01700000102", email: null, role: "OWNER" },
  { key: "owner3", name: "মোঃ জসিম উদ্দিন", phone: "01700000103", email: null, role: "OWNER" },
  { key: "owner4", name: "নাসরিন আক্তার", phone: "01700000104", email: null, role: "OWNER" },
  { key: "owner5", name: "মোঃ সেলিম রেজা", phone: "01700000105", email: null, role: "OWNER" },
  { key: "user1", name: "তানভীর হাসান", phone: "01700000201", email: "tanvir@dayarampur.test", role: "USER" },
  { key: "user2", name: "ফারজানা ইয়াসমিন", phone: "01700000202", email: null, role: "USER" },
  { key: "user3", name: "মোঃ ইমরান হোসেন", phone: "01700000203", email: null, role: "USER" },
];

emit("-- ============ users ============");
for (const user of USERS) {
  const userId = id("usr", user.key);
  emit(
    `INSERT OR IGNORE INTO users (id, name, phone, email, password_hash, role, status, phone_verified_at, created_at, updated_at) VALUES (` +
      [
        sqlString(userId),
        sqlString(user.name),
        sqlString(user.phone),
        sqlString(user.email),
        sqlString(hashPassword(PASSWORD)),
        sqlString(user.role),
        `'ACTIVE'`,
        sqlString(iso(40)),
        sqlString(iso(40)),
        sqlString(iso(40)),
      ].join(", ") +
      ");",
  );
}

/* -------------------------------------------------------------------------- */
/* Properties                                                                  */
/* -------------------------------------------------------------------------- */

interface SeedProperty {
  key: string;
  ownerKey: string;
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  propertyType: string | null;
  price: number;
  pricePeriod: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sizeValue: number | null;
  sizeUnit: string;
  floor: number | null;
  totalFloors: number | null;
  furnished: string | null;
  tenantType: string | null;
  landmark: string;
  generalLocation: string;
  exactAddress: string;
  latitude: number;
  longitude: number;
  status: string;
  featured?: boolean;
  verified?: boolean;
  amenities: string[];
  rules?: string;
  daysAgo: number;
}

const P = (p: SeedProperty) => p;

const PROPERTIES: SeedProperty[] = [
  P({
    key: "p1", ownerKey: "owner1", categoryId: "cat_basha_vhara", locationId: "loc_college_road",
    title: "কলেজ রোডে ৩ রুমের ফ্যামিলি বাসা ভাড়া",
    description:
      "দয়ারামপুর কলেজের একদম কাছে, নতুন বিল্ডিংয়ের দোতলায় ৩ বেডরুমের ফ্যামিলি ফ্ল্যাট ভাড়া হবে।\n\nবাসাটি খোলামেলা ও আলো-বাতাসপূর্ণ। সামনে বড় বারান্দা আছে। ২৪ ঘণ্টা পানির ব্যবস্থা এবং আলাদা মিটার। পরিবেশ শান্ত ও নিরাপদ, আশপাশে স্কুল, মসজিদ ও বাজার সবই হাঁটা দূরত্বে।",
    propertyType: "ফ্ল্যাট", price: 9500, pricePeriod: "MONTHLY",
    bedrooms: 3, bathrooms: 2, sizeValue: 1050, sizeUnit: "স্কয়ার ফুট", floor: 2, totalFloors: 4,
    furnished: "UNFURNISHED", tenantType: "FAMILY",
    landmark: "দয়ারামপুর কলেজের পাশে", generalLocation: "কলেজ রোড, মেইন রোড থেকে ২ মিনিট",
    exactAddress: "বাড়ি নং ৪২, কলেজ রোড, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2072, longitude: 89.0638, status: "APPROVED", featured: true, verified: true,
    amenities: ["amn_water", "amn_electric", "amn_balcony", "amn_parking", "amn_mosque", "amn_school"],
    rules: "অগ্রিম ২ মাসের ভাড়া দিতে হবে। ছাত্র/ব্যাচেলর নয়, শুধু ফ্যামিলি।",
    daysAgo: 3,
  }),
  P({
    key: "p2", ownerKey: "owner2", categoryId: "cat_basha_vhara", locationId: "loc_school_para",
    title: "স্কুল পাড়ায় ২ রুমের ছিমছাম বাসা",
    description:
      "ছোট পরিবারের জন্য উপযুক্ত ২ রুমের বাসা। টিনশেড হলেও পাকা মেঝে ও দেয়াল, বাথরুম-রান্নাঘর আলাদা।\n\nউঠানে জায়গা আছে, গাছপালা আছে। পানি ও বিদ্যুৎ নিরবচ্ছিন্ন। ভাড়া আলোচনাসাপেক্ষ।",
    propertyType: "টিনশেড", price: 5000, pricePeriod: "MONTHLY",
    bedrooms: 2, bathrooms: 1, sizeValue: 620, sizeUnit: "স্কয়ার ফুট", floor: 0, totalFloors: 1,
    furnished: "UNFURNISHED", tenantType: "FAMILY",
    landmark: "প্রাথমিক বিদ্যালয়ের পেছনে", generalLocation: "স্কুল পাড়া",
    exactAddress: "স্কুল পাড়া, হোল্ডিং ১৮, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2055, longitude: 89.0612, status: "APPROVED",
    amenities: ["amn_water", "amn_electric", "amn_kitchen", "amn_school"],
    daysAgo: 6,
  }),
  P({
    key: "p3", ownerKey: "owner3", categoryId: "cat_basha_vhara", locationId: "loc_cantonment",
    title: "ক্যান্টনমেন্ট এলাকায় সেমি-ফার্নিশড ফ্ল্যাট",
    description:
      "নিরাপদ ও পরিচ্ছন্ন এলাকায় ২ বেডরুমের সেমি-ফার্নিশড ফ্ল্যাট। খাট, আলমারি ও রান্নাঘরের ক্যাবিনেট দেওয়া আছে।\n\nলিফট, জেনারেটর ও সিসিটিভি আছে। চাকরিজীবী ছোট পরিবারের জন্য আদর্শ।",
    propertyType: "ফ্ল্যাট", price: 13000, pricePeriod: "MONTHLY",
    bedrooms: 2, bathrooms: 2, sizeValue: 900, sizeUnit: "স্কয়ার ফুট", floor: 4, totalFloors: 6,
    furnished: "SEMI_FURNISHED", tenantType: "FAMILY",
    landmark: "ক্যান্টনমেন্ট গেটের কাছে", generalLocation: "ক্যান্টনমেন্ট এলাকা",
    exactAddress: "গ্রিন ভিউ অ্যাপার্টমেন্ট, ফ্ল্যাট ৪-বি, ক্যান্টনমেন্ট রোড, দয়ারামপুর",
    latitude: 24.2101, longitude: 89.0655, status: "APPROVED", featured: true,
    amenities: ["amn_lift", "amn_generator", "amn_cctv", "amn_security", "amn_parking", "amn_furnished", "amn_water"],
    rules: "অগ্রিম ৩ মাস। পোষা প্রাণী রাখা যাবে না।",
    daysAgo: 9,
  }),
  P({
    key: "p4", ownerKey: "owner4", categoryId: "cat_basha_vhara", locationId: "loc_station_road",
    title: "স্টেশন রোডে ১ রুমের বাসা, ব্যাচেলরদের জন্য",
    description:
      "স্টেশন রোডের একদম পাশে ১ রুমের বাসা। ব্যাচেলর বা ছাত্রদের জন্য উপযুক্ত। সংযুক্ত বাথরুম আছে, রান্নার জায়গা আলাদা।\n\nবাজার, স্টেশন ও বাসস্ট্যান্ড হাঁটা দূরত্বে।",
    propertyType: "রুম", price: 3200, pricePeriod: "MONTHLY",
    bedrooms: 1, bathrooms: 1, sizeValue: 260, sizeUnit: "স্কয়ার ফুট", floor: 1, totalFloors: 2,
    furnished: "UNFURNISHED", tenantType: "BACHELOR",
    landmark: "স্টেশন রোডের মোড়", generalLocation: "স্টেশন রোড",
    exactAddress: "স্টেশন রোড, হোল্ডিং ৭, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2044, longitude: 89.0669, status: "APPROVED",
    amenities: ["amn_water", "amn_electric", "amn_market", "amn_road"],
    daysAgo: 12,
  }),
  P({
    key: "p5", ownerKey: "owner1", categoryId: "cat_basha_vhara", locationId: "loc_purbo_para",
    title: "পূর্ব পাড়ায় নতুন ৩ রুমের ফ্ল্যাট",
    description:
      "সদ্য নির্মিত ভবনের তিনতলায় ৩ বেডরুমের ফ্ল্যাট। প্রশস্ত ড্রয়িং রুম, ২টি বারান্দা, আলাদা ডাইনিং স্পেস।\n\nছাদ ব্যবহারের সুযোগ আছে। গাড়ি পার্কিংয়ের ব্যবস্থা আছে।",
    propertyType: "ফ্ল্যাট", price: 11000, pricePeriod: "MONTHLY",
    bedrooms: 3, bathrooms: 2, sizeValue: 1180, sizeUnit: "স্কয়ার ফুট", floor: 3, totalFloors: 5,
    furnished: "UNFURNISHED", tenantType: "FAMILY",
    landmark: "পূর্ব পাড়া জামে মসজিদের পাশে", generalLocation: "পূর্ব পাড়া",
    exactAddress: "হাউস ২১/এ, পূর্ব পাড়া, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2088, longitude: 89.0691, status: "APPROVED",
    amenities: ["amn_parking", "amn_roof", "amn_balcony", "amn_mosque", "amn_water", "amn_tank"],
    daysAgo: 15,
  }),
  P({
    key: "p6", ownerKey: "owner5", categoryId: "cat_basha_bikri", locationId: "loc_malanchi",
    title: "মালঞ্চিতে ৫ কাঠা জমিসহ দোতলা বাড়ি বিক্রি",
    description:
      "মালঞ্চি এলাকায় ৫ কাঠা জমির উপর নির্মিত দোতলা বাড়ি বিক্রি হবে। নিচতলায় ৩ রুম, দোতলায় ৩ রুম।\n\nসব কাগজপত্র হালনাগাদ ও পরিষ্কার। নামজারি ও খাজনা পরিশোধিত। দ্রুত হস্তান্তরযোগ্য।",
    propertyType: "দোতলা বাড়ি", price: 6500000, pricePeriod: "TOTAL",
    bedrooms: 6, bathrooms: 4, sizeValue: 2400, sizeUnit: "স্কয়ার ফুট", floor: null, totalFloors: 2,
    furnished: null, tenantType: null,
    landmark: "মালঞ্চি বাজারের কাছে", generalLocation: "মালঞ্চি",
    exactAddress: "মৌজা: মালঞ্চি, দাগ নং ১১২৪, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2019, longitude: 89.0578, status: "APPROVED", verified: true,
    amenities: ["amn_water", "amn_electric", "amn_parking", "amn_road"],
    daysAgo: 20,
  }),
  P({
    key: "p7", ownerKey: "owner2", categoryId: "cat_basha_bikri", locationId: "loc_hospital",
    title: "হাসপাতাল পাড়ায় ফ্ল্যাট বিক্রি — ১২০০ স্কয়ার ফুট",
    description:
      "হাসপাতাল পাড়ায় ৬ তলা ভবনের চতুর্থ তলায় ১২০০ স্কয়ার ফুটের ফ্ল্যাট বিক্রি হবে।\n\nলিফট, জেনারেটর ও পার্কিং আছে। দক্ষিণমুখী, পর্যাপ্ত আলো-বাতাস।",
    propertyType: "ফ্ল্যাট", price: 4200000, pricePeriod: "TOTAL",
    bedrooms: 3, bathrooms: 2, sizeValue: 1200, sizeUnit: "স্কয়ার ফুট", floor: 4, totalFloors: 6,
    furnished: null, tenantType: null,
    landmark: "উপজেলা স্বাস্থ্য কমপ্লেক্সের কাছে", generalLocation: "হাসপাতাল পাড়া",
    exactAddress: "শান্তি নিবাস, ফ্ল্যাট ৪-এ, হাসপাতাল রোড, দয়ারামপুর",
    latitude: 24.2066, longitude: 89.0601, status: "APPROVED",
    amenities: ["amn_lift", "amn_generator", "amn_parking", "amn_security"],
    daysAgo: 25,
  }),
  P({
    key: "p8", ownerKey: "owner3", categoryId: "cat_dokaan_vhara", locationId: "loc_bazar",
    title: "দয়ারামপুর বাজারে দোকান ভাড়া — মেইন রোডের পাশে",
    description:
      "বাজারের প্রধান সড়কের পাশে ২০০ স্কয়ার ফুটের দোকান ভাড়া হবে। মুদি, ফার্মেসি বা মোবাইল সার্ভিসিংয়ের জন্য উপযুক্ত।\n\nসামনে পর্যাপ্ত জায়গা, বিদ্যুৎ সংযোগ ও শাটার আছে।",
    propertyType: "দোকান", price: 7000, pricePeriod: "MONTHLY",
    bedrooms: null, bathrooms: 1, sizeValue: 200, sizeUnit: "স্কয়ার ফুট", floor: 0, totalFloors: 2,
    furnished: "UNFURNISHED", tenantType: "OFFICE",
    landmark: "বাজারের প্রধান গেটের সামনে", generalLocation: "দয়ারামপুর বাজার",
    exactAddress: "দোকান নং ১৪, দয়ারামপুর বাজার কমপ্লেক্স, বাগাতিপাড়া, নাটোর",
    latitude: 24.2061, longitude: 89.0625, status: "APPROVED", featured: true,
    amenities: ["amn_electric", "amn_road", "amn_market"],
    rules: "অগ্রিম ৬ মাসের ভাড়া (সালামি আলোচনাসাপেক্ষ)।",
    daysAgo: 5,
  }),
  P({
    key: "p9", ownerKey: "owner4", categoryId: "cat_dokaan_vhara", locationId: "loc_station_road",
    title: "স্টেশন রোডে ছোট দোকান ভাড়া",
    description:
      "স্টেশন রোডে ১২০ স্কয়ার ফুটের দোকান। চা-নাস্তা, স্টেশনারি বা ফটোকপির দোকানের জন্য ভালো।\n\nদিনভর মানুষের চলাচল থাকে।",
    propertyType: "দোকান", price: 4000, pricePeriod: "MONTHLY",
    bedrooms: null, bathrooms: null, sizeValue: 120, sizeUnit: "স্কয়ার ফুট", floor: 0, totalFloors: 1,
    furnished: "UNFURNISHED", tenantType: "OFFICE",
    landmark: "রেলগেটের পাশে", generalLocation: "স্টেশন রোড",
    exactAddress: "স্টেশন রোড, রেলগেট সংলগ্ন, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2040, longitude: 89.0673, status: "APPROVED",
    amenities: ["amn_electric", "amn_road"],
    daysAgo: 11,
  }),
  P({
    key: "p10", ownerKey: "owner5", categoryId: "cat_office_vhara", locationId: "loc_bazar",
    title: "বাজারের কাছে ৬০০ স্কয়ার ফুট অফিস স্পেস",
    description:
      "দোতলায় ৬০০ স্কয়ার ফুটের খোলা অফিস স্পেস। এনজিও, কোচিং সেন্টার বা ছোট প্রতিষ্ঠানের জন্য উপযুক্ত।\n\nআলাদা ওয়াশরুম ও পর্যাপ্ত বৈদ্যুতিক পয়েন্ট আছে।",
    propertyType: "অফিস", price: 12000, pricePeriod: "MONTHLY",
    bedrooms: null, bathrooms: 2, sizeValue: 600, sizeUnit: "স্কয়ার ফুট", floor: 2, totalFloors: 3,
    furnished: "UNFURNISHED", tenantType: "OFFICE",
    landmark: "বাজার কমপ্লেক্সের দোতলা", generalLocation: "দয়ারামপুর বাজার",
    exactAddress: "দয়ারামপুর বাজার কমপ্লেক্স, দ্বিতীয় তলা, বাগাতিপাড়া, নাটোর",
    latitude: 24.2059, longitude: 89.0628, status: "APPROVED",
    amenities: ["amn_electric", "amn_wifi", "amn_road", "amn_market"],
    daysAgo: 18,
  }),
  P({
    key: "p11", ownerKey: "owner1", categoryId: "cat_godown_vhara", locationId: "loc_tamaltala",
    title: "তমালতলায় ২০০০ স্কয়ার ফুট গুদাম ভাড়া",
    description:
      "পাকা মেঝে ও টিনের ছাউনি দেওয়া প্রশস্ত গুদাম। ট্রাক ঢোকার রাস্তা আছে।\n\nধান, সার বা নির্মাণ সামগ্রী রাখার জন্য উপযুক্ত।",
    propertyType: "গুদাম", price: 15000, pricePeriod: "MONTHLY",
    bedrooms: null, bathrooms: 1, sizeValue: 2000, sizeUnit: "স্কয়ার ফুট", floor: 0, totalFloors: 1,
    furnished: null, tenantType: "OFFICE",
    landmark: "তমালতলা মোড় থেকে ৫০০ গজ", generalLocation: "তমালতলা",
    exactAddress: "তমালতলা, মেইন রোড সংলগ্ন, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.1998, longitude: 89.0704, status: "APPROVED",
    amenities: ["amn_electric", "amn_road", "amn_security"],
    daysAgo: 22,
  }),
  P({
    key: "p12", ownerKey: "owner2", categoryId: "cat_jomi_bikri", locationId: "loc_malanchi",
    title: "মালঞ্চিতে ১০ শতক জমি বিক্রি — রাস্তার পাশে",
    description:
      "পাকা রাস্তার পাশে ১০ শতক নিষ্কণ্টক জমি বিক্রি হবে। বাড়ি করার জন্য উপযুক্ত।\n\nকাগজপত্র সব ঠিক আছে, দলিল-খতিয়ান হালনাগাদ।",
    propertyType: "বসতভিটা", price: 180000, pricePeriod: "PER_DECIMAL",
    bedrooms: null, bathrooms: null, sizeValue: 10, sizeUnit: "শতক", floor: null, totalFloors: null,
    furnished: null, tenantType: null,
    landmark: "মালঞ্চি বাজার থেকে ৩০০ গজ", generalLocation: "মালঞ্চি",
    exactAddress: "মৌজা: মালঞ্চি, জেএল নং ৪৮, দাগ নং ৯৮৭, দয়ারামপুর",
    latitude: 24.2011, longitude: 89.0569, status: "APPROVED", verified: true,
    amenities: ["amn_road"],
    daysAgo: 28,
  }),
  P({
    key: "p13", ownerKey: "owner3", categoryId: "cat_jomi_bikri", locationId: "loc_poschim_para",
    title: "পশ্চিম পাড়ায় ৫ শতক জমি বিক্রি",
    description: "শান্ত আবাসিক এলাকায় ৫ শতক জমি। চারপাশে বসতবাড়ি, বিদ্যুৎ ও পানির লাইন কাছেই।",
    propertyType: "বসতভিটা", price: 150000, pricePeriod: "PER_DECIMAL",
    bedrooms: null, bathrooms: null, sizeValue: 5, sizeUnit: "শতক", floor: null, totalFloors: null,
    furnished: null, tenantType: null,
    landmark: "পশ্চিম পাড়া প্রাথমিক বিদ্যালয়ের কাছে", generalLocation: "পশ্চিম পাড়া",
    exactAddress: "মৌজা: দয়ারামপুর, দাগ নং ৫৬২, পশ্চিম পাড়া, বাগাতিপাড়া, নাটোর",
    latitude: 24.2077, longitude: 89.0559, status: "APPROVED",
    amenities: ["amn_electric", "amn_school"],
    daysAgo: 31,
  }),
  P({
    key: "p14", ownerKey: "owner4", categoryId: "cat_jomi_vhara", locationId: "loc_tamaltala",
    title: "তমালতলায় ৩৩ শতক কৃষি জমি বছরিভিত্তিক ভাড়া",
    description: "সেচ সুবিধাসহ ৩৩ শতক আবাদি জমি বছরিভিত্তিক লিজ দেওয়া হবে। ধান ও সবজি চাষের উপযোগী।",
    propertyType: "কৃষি জমি", price: 45000, pricePeriod: "YEARLY",
    bedrooms: null, bathrooms: null, sizeValue: 33, sizeUnit: "শতক", floor: null, totalFloors: null,
    furnished: null, tenantType: null,
    landmark: "তমালতলা খালের পাশে", generalLocation: "তমালতলা",
    exactAddress: "মৌজা: তমালতলা, দাগ নং ২২১৪, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.1985, longitude: 89.0718, status: "APPROVED",
    amenities: ["amn_water", "amn_road"],
    daysAgo: 34,
  }),
  P({
    key: "p15", ownerKey: "owner5", categoryId: "cat_mess", locationId: "loc_college_road",
    title: "কলেজ রোডে ছাত্রদের মেস — সিট খালি",
    description:
      "দয়ারামপুর কলেজের কাছে ছাত্রদের মেসে ৪টি সিট খালি আছে। প্রতি রুমে ২ জন।\n\nখাবারের ব্যবস্থা আছে (আলাদা মিল চার্জ)। ওয়াইফাই ও পড়ার টেবিল দেওয়া।",
    propertyType: "মেস", price: 2500, pricePeriod: "MONTHLY",
    bedrooms: 1, bathrooms: 2, sizeValue: 150, sizeUnit: "স্কয়ার ফুট", floor: 2, totalFloors: 3,
    furnished: "FURNISHED", tenantType: "STUDENT",
    landmark: "কলেজ গেট থেকে ২ মিনিট", generalLocation: "কলেজ রোড",
    exactAddress: "ছাত্রাবাস ভবন, কলেজ রোড, হোল্ডিং ৩৩, দয়ারামপুর",
    latitude: 24.2075, longitude: 89.0642, status: "APPROVED",
    amenities: ["amn_wifi", "amn_furnished", "amn_water", "amn_electric", "amn_school"],
    rules: "ধূমপান নিষিদ্ধ। রাত ১০টার মধ্যে ফিরতে হবে।",
    daysAgo: 4,
  }),
  P({
    key: "p16", ownerKey: "owner1", categoryId: "cat_mess", locationId: "loc_hospital",
    title: "হাসপাতাল পাড়ায় মহিলা মেস",
    description:
      "চাকরিজীবী ও ছাত্রী মহিলাদের জন্য নিরাপদ মেস। সিসিটিভি ও মহিলা তত্ত্বাবধায়ক আছেন।\n\nতিন বেলা খাবারের ব্যবস্থা আছে।",
    propertyType: "মেস", price: 3000, pricePeriod: "MONTHLY",
    bedrooms: 1, bathrooms: 2, sizeValue: 160, sizeUnit: "স্কয়ার ফুট", floor: 1, totalFloors: 2,
    furnished: "FURNISHED", tenantType: "STUDENT",
    landmark: "স্বাস্থ্য কমপ্লেক্সের বিপরীতে", generalLocation: "হাসপাতাল পাড়া",
    exactAddress: "মহিলা ছাত্রীনিবাস, হাসপাতাল রোড, দয়ারামপুর, বাগাতিপাড়া",
    latitude: 24.2069, longitude: 89.0597, status: "APPROVED",
    amenities: ["amn_cctv", "amn_security", "amn_furnished", "amn_wifi"],
    daysAgo: 8,
  }),
  P({
    key: "p17", ownerKey: "owner2", categoryId: "cat_sublet", locationId: "loc_purbo_para",
    title: "পূর্ব পাড়ায় সাবলেট — ১ রুম, ফ্যামিলির সাথে",
    description:
      "ছোট পরিবারের সাথে একটি রুম সাবলেট দেওয়া হবে। রান্নাঘর ও বারান্দা শেয়ার করতে হবে, বাথরুম আলাদা।\n\nচাকরিজীবী দম্পতি বা ছোট পরিবারের জন্য উপযুক্ত।",
    propertyType: "সাবলেট", price: 4500, pricePeriod: "MONTHLY",
    bedrooms: 1, bathrooms: 1, sizeValue: 180, sizeUnit: "স্কয়ার ফুট", floor: 2, totalFloors: 4,
    furnished: "SEMI_FURNISHED", tenantType: "FAMILY",
    landmark: "পূর্ব পাড়া মসজিদের কাছে", generalLocation: "পূর্ব পাড়া",
    exactAddress: "হাউস ৯, পূর্ব পাড়া, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2085, longitude: 89.0687, status: "APPROVED",
    amenities: ["amn_water", "amn_electric", "amn_kitchen", "amn_mosque"],
    rules: "শুধু ফ্যামিলি। রাতে অতিথি রাখা যাবে না।",
    daysAgo: 7,
  }),
  P({
    key: "p18", ownerKey: "owner3", categoryId: "cat_basha_vhara", locationId: "loc_poschim_para",
    title: "পশ্চিম পাড়ায় ২ রুমের বাসা ভাড়া",
    description:
      "পশ্চিম পাড়ায় নিরিবিলি পরিবেশে ২ রুমের বাসা। সামনে ছোট উঠান আছে।\n\nপানি ও বিদ্যুতের কোনো সমস্যা নেই।",
    propertyType: "টিনশেড", price: 5500, pricePeriod: "MONTHLY",
    bedrooms: 2, bathrooms: 1, sizeValue: 650, sizeUnit: "স্কয়ার ফুট", floor: 0, totalFloors: 1,
    furnished: "UNFURNISHED", tenantType: "FAMILY",
    landmark: "পশ্চিম পাড়া মোড়", generalLocation: "পশ্চিম পাড়া",
    exactAddress: "হোল্ডিং ২৭, পশ্চিম পাড়া, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2080, longitude: 89.0563, status: "PENDING",
    amenities: ["amn_water", "amn_electric", "amn_kitchen"],
    daysAgo: 1,
  }),
  P({
    key: "p19", ownerKey: "owner4", categoryId: "cat_dokaan_vhara", locationId: "loc_college_road",
    title: "কলেজ রোডে দোকান ভাড়া — কোচিং/স্টেশনারির জন্য",
    description: "কলেজের সামনে ১৫০ স্কয়ার ফুটের দোকান। স্টেশনারি বা ফটোকপির ব্যবসার জন্য চমৎকার লোকেশন।",
    propertyType: "দোকান", price: 5500, pricePeriod: "MONTHLY",
    bedrooms: null, bathrooms: null, sizeValue: 150, sizeUnit: "স্কয়ার ফুট", floor: 0, totalFloors: 2,
    furnished: "UNFURNISHED", tenantType: "OFFICE",
    landmark: "কলেজ গেটের সামনে", generalLocation: "কলেজ রোড",
    exactAddress: "কলেজ রোড, দোকান নং ৩, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2073, longitude: 89.0636, status: "PENDING",
    amenities: ["amn_electric", "amn_road", "amn_school"],
    daysAgo: 2,
  }),
  P({
    key: "p20", ownerKey: "owner5", categoryId: "cat_basha_vhara", locationId: "loc_bazar",
    title: "বাজারের কাছে ৩ রুমের বাসা (ভাড়া হয়ে গেছে)",
    description: "বাজারের কাছে ৩ রুমের বাসা। ইতিমধ্যে ভাড়া হয়ে গেছে — নতুন করে খালি হলে জানানো হবে।",
    propertyType: "ফ্ল্যাট", price: 8500, pricePeriod: "MONTHLY",
    bedrooms: 3, bathrooms: 2, sizeValue: 980, sizeUnit: "স্কয়ার ফুট", floor: 1, totalFloors: 3,
    furnished: "UNFURNISHED", tenantType: "FAMILY",
    landmark: "বাজার মসজিদের পেছনে", generalLocation: "দয়ারামপুর বাজার",
    exactAddress: "হোল্ডিং ৫৫, বাজার রোড, দয়ারামপুর, বাগাতিপাড়া, নাটোর",
    latitude: 24.2057, longitude: 89.0619, status: "RENTED",
    amenities: ["amn_water", "amn_electric", "amn_market"],
    daysAgo: 45,
  }),
];

emit("");
emit("-- ============ properties ============");

let publicRef = 1000;
for (const property of PROPERTIES) {
  publicRef += 1;
  const propertyId = id("prp", property.key);
  const ownerId = id("usr", property.ownerKey);
  const createdAt = iso(property.daysAgo);
  const isPublic = property.status === "APPROVED" || property.status === "RENTED";
  const slug = `${slugifyForSeed(property.title)}-${publicRef}`;

  emit(
    `INSERT OR IGNORE INTO properties (id, public_ref, slug, owner_id, category_id, location_id, title, description, property_type, price, price_period, is_negotiable, bedrooms, bathrooms, size_value, size_unit, floor, total_floors, furnished, tenant_type, available_from, rules, landmark, general_location, exact_address, latitude, longitude, contact_phone, owner_name, status, is_featured, is_verified, views_count, unique_views_count, approved_by, approved_at, published_at, expires_at, created_at, updated_at) VALUES (` +
      [
        sqlString(propertyId),
        String(publicRef),
        sqlString(slug),
        sqlString(ownerId),
        sqlString(property.categoryId),
        sqlString(property.locationId),
        sqlString(property.title),
        sqlText(property.description),
        sqlString(property.propertyType),
        String(property.price),
        sqlString(property.pricePeriod),
        "0",
        property.bedrooms === null ? "NULL" : String(property.bedrooms),
        property.bathrooms === null ? "NULL" : String(property.bathrooms),
        property.sizeValue === null ? "NULL" : String(property.sizeValue),
        sqlString(property.sizeUnit),
        property.floor === null ? "NULL" : String(property.floor),
        property.totalFloors === null ? "NULL" : String(property.totalFloors),
        sqlString(property.furnished),
        sqlString(property.tenantType),
        sqlString(dateOnly(7)),
        sqlText(property.rules ?? null),
        sqlString(property.landmark),
        sqlString(property.generalLocation),
        sqlString(property.exactAddress),
        String(property.latitude),
        String(property.longitude),
        // Fake, clearly-reserved test numbers.
        sqlString(`0170000${String(9000 + publicRef - 1000).slice(0, 4)}`),
        sqlString(USERS.find((u) => u.key === property.ownerKey)!.name),
        sqlString(property.status),
        property.featured ? "1" : "0",
        property.verified ? "1" : "0",
        String(20 + ((publicRef * 37) % 400)),
        String(10 + ((publicRef * 17) % 180)),
        isPublic ? sqlString(id("usr", "admin")) : "NULL",
        isPublic ? sqlString(createdAt) : "NULL",
        isPublic ? sqlString(createdAt) : "NULL",
        isPublic ? sqlString(isoFuture(60 - property.daysAgo)) : "NULL",
        sqlString(createdAt),
        sqlString(createdAt),
      ].join(", ") +
      ");",
  );

  for (const amenityId of property.amenities) {
    emit(
      `INSERT OR IGNORE INTO property_amenities (property_id, amenity_id) VALUES (${sqlString(propertyId)}, ${sqlString(amenityId)});`,
    );
  }
}

/**
 * Slugify for the seed only — a simplified transliteration is enough here,
 * since the real one lives in src/lib/slug.ts and runs at listing-creation time.
 */
function slugifyForSeed(title: string): string {
  const map: Record<string, string> = {
    বাসা: "basha", ভাড়া: "vhara", বিক্রি: "bikri", দোকান: "dokaan", অফিস: "office",
    গুদাম: "godown", জমি: "jomi", মেস: "mess", সাবলেট: "sublet", রুমের: "room",
    ফ্ল্যাট: "flat", বাড়ি: "bari", শতক: "shotok", কাঠা: "katha",
  };
  const words = title.split(/\s+/).map((word) => map[word] ?? "").filter(Boolean);
  const base = words.length > 0 ? words.join("-") : "property";
  return `${base}-dayarampur`;
}

/* -------------------------------------------------------------------------- */
/* Favorites, views, payments, unlocks, reports                                */
/* -------------------------------------------------------------------------- */

emit("");
emit("-- ============ favorites ============");
const FAVORITES: [string, string][] = [
  ["user1", "p1"], ["user1", "p3"], ["user1", "p15"],
  ["user2", "p2"], ["user2", "p5"],
  ["user3", "p8"], ["user3", "p1"],
];
for (const [userKey, propertyKey] of FAVORITES) {
  emit(
    `INSERT OR IGNORE INTO favorites (id, user_id, property_id, created_at) VALUES (` +
      [
        sqlString(id("fav", `${userKey}-${propertyKey}`)),
        sqlString(id("usr", userKey)),
        sqlString(id("prp", propertyKey)),
        sqlString(iso(2)),
      ].join(", ") +
      ");",
  );
}

emit("");
emit("-- ============ property views ============");
const VIEWS: [string, string, number][] = [
  ["user1", "p1", 1], ["user2", "p1", 2], ["user3", "p1", 3],
  ["user1", "p3", 1], ["user2", "p8", 1], ["user3", "p15", 2],
];
for (const [userKey, propertyKey, daysAgo] of VIEWS) {
  const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  emit(
    `INSERT OR IGNORE INTO property_views (id, property_id, user_id, session_hash, view_date, created_at) VALUES (` +
      [
        sqlString(id("vw", `${userKey}-${propertyKey}-${daysAgo}`)),
        sqlString(id("prp", propertyKey)),
        sqlString(id("usr", userKey)),
        sqlString(createHash("sha256").update(`seed:${userKey}`).digest("hex")),
        sqlString(day),
        sqlString(iso(daysAgo)),
      ].join(", ") +
      ");",
  );
}

emit("");
emit("-- ============ payments and contact unlocks ============");

/**
 * Three settled unlocks plus one failed payment, so the payment table, the
 * unlock table and the admin dashboard all have realistic content — including
 * the case where a payment exists but did NOT grant access.
 */
const PAYMENTS: { userKey: string; propertyKey: string; status: string; daysAgo: number }[] = [
  { userKey: "user1", propertyKey: "p1", status: "PAID", daysAgo: 2 },
  { userKey: "user2", propertyKey: "p3", status: "PAID", daysAgo: 5 },
  { userKey: "user3", propertyKey: "p8", status: "PAID", daysAgo: 1 },
  { userKey: "user1", propertyKey: "p5", status: "FAILED", daysAgo: 3 },
];

for (const payment of PAYMENTS) {
  const paymentId = id("pay", `${payment.userKey}-${payment.propertyKey}`);
  const transactionId = `U${1000 + PROPERTIES.findIndex((p) => p.key === payment.propertyKey) + 1}-seed${payment.userKey}`;
  const paid = payment.status === "PAID";
  const at = iso(payment.daysAgo);

  emit(
    `INSERT OR IGNORE INTO payments (id, transaction_id, user_id, property_id, amount, currency, gateway, status, validation_id, paid_at, failure_reason, created_at, updated_at) VALUES (` +
      [
        sqlString(paymentId),
        sqlString(transactionId),
        sqlString(id("usr", payment.userKey)),
        sqlString(id("prp", payment.propertyKey)),
        "50",
        `'BDT'`,
        `'SSLCOMMERZ'`,
        sqlString(payment.status),
        paid ? sqlString(`seedval-${paymentId.slice(-8)}`) : "NULL",
        paid ? sqlString(at) : "NULL",
        paid ? "NULL" : `'card_declined'`,
        sqlString(at),
        sqlString(at),
      ].join(", ") +
      ");",
  );

  if (paid) {
    emit(
      `INSERT OR IGNORE INTO contact_unlocks (id, user_id, property_id, payment_id, status, unlocked_at, created_at, updated_at) VALUES (` +
        [
          sqlString(id("unl", `${payment.userKey}-${payment.propertyKey}`)),
          sqlString(id("usr", payment.userKey)),
          sqlString(id("prp", payment.propertyKey)),
          sqlString(paymentId),
          `'ACTIVE'`,
          sqlString(at),
          sqlString(at),
          sqlString(at),
        ].join(", ") +
        ");",
    );
    emit(
      `UPDATE properties SET unlocks_count = unlocks_count + 1 WHERE id = ${sqlString(id("prp", payment.propertyKey))};`,
    );
  }
}

emit("");
emit("-- ============ reports ============");
const REPORTS: { userKey: string; propertyKey: string; reason: string; details: string; status: string }[] = [
  {
    userKey: "user2", propertyKey: "p4", reason: "ALREADY_RENTED",
    details: "ফোন করে জানলাম বাসাটি গত সপ্তাহেই ভাড়া হয়ে গেছে।", status: "OPEN",
  },
  {
    userKey: "user3", propertyKey: "p9", reason: "WRONG_PRICE",
    details: "বিজ্ঞাপনে ৪০০০ লেখা, কিন্তু মালিক ৫৫০০ চাচ্ছেন।", status: "INVESTIGATING",
  },
];
for (const report of REPORTS) {
  emit(
    `INSERT OR IGNORE INTO reports (id, property_id, reporter_id, reason, details, status, created_at, updated_at) VALUES (` +
      [
        sqlString(id("rep", `${report.userKey}-${report.propertyKey}`)),
        sqlString(id("prp", report.propertyKey)),
        sqlString(id("usr", report.userKey)),
        sqlString(report.reason),
        sqlText(report.details),
        sqlString(report.status),
        sqlString(iso(1)),
        sqlString(iso(1)),
      ].join(", ") +
      ");",
  );
}

emit("");
emit(`UPDATE sequences SET value = ${publicRef} WHERE name = 'property_ref' AND value < ${publicRef};`);

/* -------------------------------------------------------------------------- */

process.stdout.write(
  [
    "-- dayarampur.com development seed data",
    "-- Generated by scripts/seed.ts — do NOT run against production.",
    `-- Every seeded account uses the password: ${PASSWORD}`,
    "-- All phone numbers are fake test numbers.",
    "",
    ...lines,
    "",
  ].join("\n"),
);
