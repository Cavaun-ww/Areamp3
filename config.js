// ─────────────────────────────────────────────────────────────
//  Area MP3 SITE CONFIG — the only file you need to edit to go live.
//  See README.md for where each value comes from.
// ─────────────────────────────────────────────────────────────
window.APP_CONFIG = {
  SITE_NAME: "Area MP3",

  // Supabase → Project Settings → API Keys (Area MP3 project; the publishable key is safe to be public)
  SUPABASE_URL: "https://kvmucaemqmyhceuftsca.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_3na-tZSS1C9p72ARb_pbQQ_EChk4Pwf",

  // Shown on the Privacy and Terms pages
  SUPPORT_EMAIL: "cavauntechnologies@gmail.com",

  // Show "Continue with Google" (turn Google on in Supabase → Authentication → Providers)
  GOOGLE_SIGN_IN: true,

  // PayPal → developer.paypal.com → Apps & Credentials → Live → "Area MP3" app (Client ID is public, safe here)
  PAYPAL_CLIENT_ID: "BAA-MloBkGKqslKi3-_KafWjk2ABgrWloxoR8XZtyrJNQO-VfhkB7DRFF6qNdh-ojizFwNRNPkW2N0Una0",
  CURRENCY: "USD",

  // Plans (shown on the site). PayPal's fee comes off each sale first, then the site keeps:
  //   Free artists: FREE_FEE_PERCENT · Pro artists: PRO_FEE_PERCENT · Pro costs PRO_PRICE a year.
  // The real numbers live on the server (defaults 7 / 0 / 29.99); keep these the same.
  FREE_FEE_PERCENT: 7,
  PRO_FEE_PERCENT: 0,
  PRO_PRICE: 29.99,

  // Song prices artists can choose (0 = free download)
  MIN_PRICE: 0.01,       // no real limit: any price above free
  MAX_PRICE: 999999.99,  // the most the database can hold

  // Upload limits (also enforced by the storage buckets in supabase/schema.sql)
  MAX_MP3_MB: 40,
  MAX_WAV_MB: 50,   // Supabase free plan's per-file maximum; raise it on a paid plan (see README)
  MAX_IMAGE_MB: 10,
  MAX_VIDEO_MB: 20,
  MAX_MODEL_MB: 25,   // 3D models (.glb). Under 10 MB loads fastest on phones.

  // Length of the free preview everyone can hear before buying (seconds)
  PREVIEW_SECONDS: 30,
};
