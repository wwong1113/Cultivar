document.documentElement.classList.add("js");
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
const LS = {
  get: (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch (e) {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      alert("Browser storage is full.");
    }
  },
};
// Only these events are counted (the database ignores anything else).
const TRACKED = new Set([
  "page_home",
  "book_click",
  "book_view",
  "booking_done",
  "signup_student",
  "signup_tutor",
]);
const track = (e) => {
  if (!sb || !TRACKED.has(e)) return;
  sb.rpc("track_event", { p_event: e }).then(
    () => {},
    () => {},
  );
};
// ===== CONFIG =====
// The URL and publishable key below are PUBLIC by design: every browser sees them.
// Your protection is Row Level Security (supabase-setup.sql), not hiding these values.
// NEVER put the service_role / secret key in this file.
const CFG = {
  currency: "CAD",
  supabaseUrl: "https://tginxgkjvhwjzhovbqvi.supabase.co",
  supabaseKey: "sb_publishable_DabNqyM8t7ANJFJpXiOjIA_Jcnk5Xm6",
  // Truthy = card payments are on. The "create-checkout" Edge Function does the real work
  // (the price always comes from the database, never from the browser).
  checkoutUrl:
    "https://tginxgkjvhwjzhovbqvi.supabase.co/functions/v1/create-checkout",
  stripeLink: "",
};
// Supabase client (needs the supabase-js script tag in index.html)
// PKCE keeps the email-confirmation redirect in ?code= so it doesn't clash with the #hash router.
const sb = window.supabase?.createClient
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
const AUTH = { busy: 0 };
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PAY_LINK_RE = /^https:\/\/(buy|donate)\.stripe\.com\/[^\s"<>]*$/;

function authMsg(e) {
  const m = String(e?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "Incorrect email or password.";
  if (m.includes("not confirmed"))
    return "Please confirm your email first. Check your inbox for the link.";
  if (m.includes("banned") || m.includes("suspended"))
    return "This account is suspended. Please contact Cultivar+.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "That email already has an account. Try logging in.";
  if (e?.status === 429 || m.includes("rate limit"))
    return "Too many attempts. Please wait a minute and try again.";
  return e?.message || "Something went wrong. Please try again.";
}
// Edge Function errors hide the useful message inside error.context (a Response).
async function fnErr(error) {
  try {
    const j = await error.context.json();
    if (j?.error) return j.error;
  } catch (_) {}
  return error?.message || "Something went wrong.";
}

// ----- profile photos -----
function loadImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file),
      i = new Image();
    i.onload = () => {
      URL.revokeObjectURL(u);
      res(i);
    };
    i.onerror = () => {
      URL.revokeObjectURL(u);
      rej(new Error("We couldn't read that image. Try a JPG or PNG."));
    };
    i.src = u;
  });
}
// Re-encode every photo as a small JPEG: this strips hidden metadata (like GPS location),
// guarantees it's a real image, and keeps files tiny.
async function avatarBlob(file) {
  if (!file || !/^image\//.test(file.type || ""))
    throw new Error("Please choose an image file (JPG or PNG).");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("That photo is too large. Please choose one under 20 MB.");
  const img = await loadImg(file),
    w0 = img.naturalWidth,
    h0 = img.naturalHeight;
  if (!w0 || !h0)
    throw new Error("We couldn't read that image. Try a JPG or PNG.");
  const sc = Math.min(1, 640 / Math.max(w0, h0)),
    c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w0 * sc));
  c.height = Math.max(1, Math.round(h0 * sc));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("We couldn't process that image. Try another.");
  return blob;
}
// Uploads to avatars/<user-id>/avatar.jpg (the only path storage policies allow for that user).
async function uploadTutorPhoto(file, userId) {
  if (!sb) {
    console.warn("Supabase SDK is not loaded.");
    return "";
  }
  try {
    if (!userId) throw new Error("Please log in first.");
    const blob = await avatarBlob(file),
      path = `${userId}/avatar.jpg`;
    const { error } = await sb.storage.from("avatars").upload(path, blob, {
      upsert: true,
      cacheControl: "3600",
      contentType: "image/jpeg",
    });
    if (error) throw error;
    // ?v= makes browsers fetch the new picture instead of the cached old one
    return (
      sb.storage.from("avatars").getPublicUrl(path).data.publicUrl +
      "?v=" +
      Date.now()
    );
  } catch (err) {
    console.error("Storage upload error:", err);
    alert("Photo upload failed: " + err.message);
    return "";
  }
}
// ===== CONTENT =====
const C = {
  tagline: "Learn from someone who’s been where you are.",
  sub: "Personalized Grade 9–12 tutoring from university students who understand the courses, the pressure, and what comes next.",
  facts: [
    "Grades 9–12",
    "Personalized 1-on-1 support",
    "University student tutors",
  ],
  // Hero "Where our tutors study" list, west to east. The city must match a key in
  // MAP.cities (London, Waterloo, Hamilton, Toronto, Kingston, Ottawa) to get a pin.
  unis: [
    ["Western University", "London"],
    ["University of Waterloo", "Waterloo"],
    ["Wilfrid Laurier University", "Waterloo"],
    ["McMaster University", "Hamilton"],
    ["University of Toronto", "Toronto"],
    ["York University", "Toronto"],
    ["Toronto Metropolitan University", "Toronto"],
    ["Queen’s University", "Kingston"],
    ["University of Ottawa", "Ottawa"],
    ["Carleton University", "Ottawa"],
  ],
  intro:
    "Cultivar+ connects students in Grades 9–12 with university tutors who recently took the same courses and made the same transition.",
  overview: [
    "Cultivar+ is a tutoring and mentorship service that goes above and beyond, connecting high school students with university student tutors who have recently gone through the same courses, university applications, and transition into post-secondary education.",
    "We primarily serve students in Grades 9 to 12, with a focus on senior-level courses such as Advanced Functions, Calculus & Vectors, Biology, Chemistry, Business, English, and other high school subjects.",
    "Our tutors are current university students from different programs and schools. Students can choose tutors based not only on the subject they need help with, but also on their personality, university, program, interests, and experience.",
    "The goal is to make tutoring feel more personal than a traditional tutoring centre. We want students to learn from someone who feels approachable and relatable: someone who was recently in their position.",
  ],
  mission: [
    "Our mission is to help high school students grow academically while connecting them with mentors and alumni who understand what they are going through.",
    "We believe tutoring should go beyond completing homework or preparing for the next test. Students should be able to build confidence, improve their understanding, develop stronger study habits, and learn from someone who has recently experienced the same academic and university transition.",
    "Our tutors provide personalized academic support while also being available to share their own experiences with university programs, applications, study habits, and student life.",
  ],
  words: [
    "Personal",
    "Friendly",
    "Youthful",
    "Trustworthy",
    "Modern",
    "Supportive",
    "Professional",
  ],
  subjects: [
    "Grade 9–10 Mathematics",
    "Functions",
    "Advanced Functions",
    "Calculus & Vectors",
    "Grade 9–10 Science",
    "Biology",
    "Chemistry",
    "Physics",
    "Business",
    "Economics",
    "English",
    "Other subjects",
  ],
  help: [
    [
      "Math",
      [
        "Grade 9–10 Mathematics",
        "Functions",
        "Advanced Functions",
        "Calculus & Vectors",
      ],
    ],
    ["Sciences", ["Grade 9–10 Science", "Biology", "Chemistry", "Physics"]],
    [
      "English & Business",
      ["English", "Business", "Economics", "Other high school subjects"],
    ],
    [
      "Beyond the classroom",
      [
        "University applications",
        "Choosing a program",
        "Study habits",
        "Student life",
      ],
    ],
  ],
  quotes: [
    [
      "My tutor had just taken the same calculus course, and it showed.",
      "Student, Grade 12",
    ],
    [
      "She explained how she picked her program, and it calmed me down.",
      "Student, Grade 11",
    ],
    ["Booking and paying took two minutes.", "Parent, Grade 10"],
  ],
  faq: [
    [
      "How do I choose a tutor?",
      "Browse tutors by subject, university, program or interests. Read their profile, then book a time that works.",
    ],
    [
      "How much does a session cost?",
      "Each tutor’s hourly rate is shown on their profile. You pay by credit card after booking.",
    ],
    [
      "How does payment work?",
      "Once you book, you pay securely by card through Stripe. You can also pay from your dashboard.",
    ],
    [
      "Can I cancel or reschedule?",
      "You can cancel from your dashboard up to 24 hours before your session.",
    ],
    [
      "Who are the tutors?",
      "Current university students who recently took the same high school courses and went through the application process.",
    ],
  ],
  email: "cultivarplus@gmail.com",
  phone: "(000) 000-0000",
};
// ===== DATA LAYER =====
// Everything lives in Supabase. The rest of the app still reads through the small
// synchronous helpers below (U, B, S, me, allTutors...), which are backed by this
// in-memory cache that the load*() functions refill from the database.
const DA = {
  1: [16, 20],
  2: [16, 20],
  3: [16, 20],
  4: [16, 20],
  5: [16, 20],
  6: [10, 16],
};
const SEED = [].map((t) => ({
  role: "tutor",
  seed: 1,
  photo: "",
  avail: DA,
  blocked: [],
  ...t,
}));
const DB = {
  me: null, // logged-in user ({role:'student'|'tutor'|'admin', ...}) or null
  issue: "", // why login didn't complete: suspended / noprofile / network
  detail: "", // the technical reason, shown on the login page to help debugging
  tutors: [], // public directory
  busy: [], // taken time slots (no personal info)
  bookings: [], // only the ones this user is allowed to see
  users: [], // admin only
  messages: [], // admin only
  an: {}, // admin only
  settings: {},
  link: "",
};
const FRESH = { pub: 0, mine: 0, adm: 0 };
const U = () => DB.users,
  B = () => DB.bookings;
const allTutors = () => [...SEED, ...DB.tutors],
  tut = (id) => allTutors().find((t) => t.id === id);
const me = () => DB.me;
const DEF = {
  rate: 40,
  len: 60,
  buf: 15,
  notice: 12,
  window: 60,
  tz: "America/Toronto",
  link: "https://meet.google.com/your-link",
};
const S = () => ({ ...DEF, ...DB.settings, link: DB.link || DEF.link });

const mapProfile = (p) => ({
  id: p.id,
  role: p.role,
  status: p.status,
  name: p.name,
  email: p.email || "",
  grade: p.grade,
  uni: p.uni || "",
  program: p.program || "",
  // "English / Writing" was renamed to "English"; older profiles still store the old name
  subjects: (p.subjects || []).map((s) =>
    s === "English / Writing" ? "English" : s,
  ),
  vibe: p.vibe || [],
  bio: p.bio || "",
  payLink: p.pay_link || "",
  photo: p.photo || "",
  rate: p.rate == null ? undefined : +p.rate,
  avail: p.avail || {},
  blocked: p.blocked || [],
  created: Date.parse(p.created_at),
});
const mapTutor = (p) =>
  mapProfile({ ...p, role: "tutor", status: "active", email: "" });
const mapBooking = (r) => ({
  id: r.id,
  tutor: r.tutor_id,
  tutorName: r.tutor_name,
  student: r.student_id,
  studentName: r.student_name,
  email: r.student_email,
  grade: r.grade,
  subject: r.subject,
  start: Date.parse(r.start_at),
  end: Date.parse(r.end_at),
  format: r.format,
  notes: r.notes,
  status: r.status,
  paid: r.paid,
  amount: +r.amount,
  created: Date.parse(r.created_at),
  tz: r.tz,
});

// Public data: tutors, settings and which slots are taken (works logged out).
async function loadPublic() {
  if (!sb) return;
  try {
    const [t, s, b] = await Promise.all([
      sb.rpc("list_tutors"),
      sb
        .from("app_settings")
        .select("rate,len,buf,notice,window_days,tz")
        .eq("id", 1)
        .maybeSingle(),
      sb.rpc("list_busy"),
    ]);
    if (t.error) console.error(t.error);
    else DB.tutors = (t.data || []).map(mapTutor);
    if (s.error) console.error(s.error);
    else if (s.data)
      DB.settings = {
        rate: +s.data.rate,
        len: s.data.len,
        buf: s.data.buf,
        notice: s.data.notice,
        window: s.data.window_days,
        tz: s.data.tz,
      };
    if (b.error) console.error(b.error);
    else
      DB.busy = (b.data || []).map((r) => ({
        tutor: r.tutor_id,
        start: Date.parse(r.start_at),
        end: Date.parse(r.end_at),
      }));
  } catch (e) {
    console.error(e);
  }
  FRESH.pub = Date.now();
}
// Who is logged in. Admin status is decided by the database, never by the browser.
async function loadSession() {
  DB.me = null;
  DB.issue = "";
  DB.detail = "";
  if (!sb) return;
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return;
  const uid = session.user.id;
  const [adm, prof] = await Promise.all([
    sb.rpc("is_admin"),
    sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
  ]);
  if (adm.error || prof.error) {
    DB.issue = "network"; // keep the session; try again on next load
    DB.detail = (adm.error || prof.error).message || "";
    console.error("Could not load account:", adm.error || prof.error);
    return;
  }
  if (adm.data === true) {
    DB.me = {
      id: uid,
      role: "admin",
      name: "Admin",
      email: session.user.email,
    };
    return;
  }
  if (prof.data && prof.data.status === "active") {
    DB.me = mapProfile(prof.data);
    return;
  }
  DB.issue = prof.data ? "suspended" : "noprofile";
  await sb.auth.signOut();
}
async function refreshMe() {
  if (!sb || !DB.me || DB.me.role === "admin") return;
  const r = await sb
    .from("profiles")
    .select("*")
    .eq("id", DB.me.id)
    .maybeSingle();
  if (r.data) DB.me = mapProfile(r.data);
}
// My bookings (students/tutors see their own, admin sees all - enforced by RLS) + meeting link.
async function loadMine() {
  if (!sb) return;
  if (!DB.me) {
    DB.bookings = [];
    DB.link = "";
    FRESH.mine = Date.now();
    return;
  }
  try {
    const [b, l] = await Promise.all([
      sb.from("bookings").select("*").order("start_at"),
      sb.rpc("meeting_link"),
    ]);
    if (b.error) console.error(b.error);
    else DB.bookings = (b.data || []).map(mapBooking);
    if (!l.error) DB.link = l.data || "";
  } catch (e) {
    console.error(e);
  }
  FRESH.mine = Date.now();
}
async function loadAdmin() {
  if (!sb || DB.me?.role !== "admin") return;
  try {
    const [u, m, a] = await Promise.all([
      sb.from("profiles").select("*").order("created_at"),
      sb
        .from("contact_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      sb.from("analytics").select("*"),
    ]);
    if (!u.error) DB.users = (u.data || []).map(mapProfile);
    if (!m.error) DB.messages = m.data || [];
    if (!a.error)
      DB.an = Object.fromEntries((a.data || []).map((r) => [r.event, +r.n]));
  } catch (e) {
    console.error(e);
  }
  FRESH.adm = Date.now();
}
async function boot() {
  await loadSession();
  await Promise.all([loadPublic(), loadMine()]);
  if (DB.me?.role === "admin") await loadAdmin();
}
function resetSession() {
  Object.assign(DB, {
    me: null,
    issue: "",
    bookings: [],
    users: [],
    messages: [],
    an: {},
    link: "",
  });
  FRESH.mine = FRESH.adm = 0;
}
// Save changes to MY OWN profile (the database only lets people edit their own safe fields).
async function saveMine(patch) {
  const cur = me();
  if (!cur || cur.role === "admin") return false;
  const { error } = await sb.from("profiles").update(patch).eq("id", cur.id);
  if (error) {
    alert("Could not save: " + error.message);
    return false;
  }
  await Promise.all([refreshMe(), loadPublic()]);
  return true;
}
// Admin-only actions that need the service key live in the "admin-users" Edge Function.
async function adminFn(action, payload = {}) {
  const { data, error } = await sb.functions.invoke("admin-users", {
    body: { action, ...payload },
  });
  if (error) throw new Error(await fnErr(error));
  if (data?.error) throw new Error(data.error);
  return data;
}
// time helpers
function offs(ms, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(ms / 1000) * 1000
  );
}
function zoned(y, m, d, h, mi, tz) {
  const g = Date.UTC(y, m, d, h, mi);
  let t = g - offs(g, tz);
  t = g - offs(t, tz);
  return t;
}
const fmt = (ms, tz, o) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...o }).format(ms),
  dkey = (ms, tz) =>
    fmt(ms, tz, { year: "numeric", month: "2-digit", day: "2-digit" }),
  tm = (ms, tz) =>
    fmt(ms, tz, { hour: "numeric", minute: "2-digit", hour12: true })
      .replace(/\./g, "")
      .toUpperCase();
const money = (n) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: CFG.currency,
    }).format(n),
  rateOf = (t) => t.rate ?? S().rate,
  price = (t, b) => rateOf(t) * (b ? (b.end - b.start) / 36e5 : S().len / 60);
const DOW = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  gl = (g) => "Grade " + g;
function slotsFor(t) {
  const s = S(),
    now = Date.now(),
    out = [],
    t0 = new Date(),
    bk = DB.busy.filter((b) => b.tutor === t.id);
  for (let i = 0; i <= s.window + 1; i++) {
    const dt = new Date(
        Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate() + i),
      ),
      h = t.avail?.[dt.getUTCDay()];
    if (!h) continue;
    if ((t.blocked || []).includes(dt.toISOString().slice(0, 10))) continue;
    for (let m = h[0] * 60; m + s.len <= h[1] * 60; m += s.len) {
      const st = zoned(
          dt.getUTCFullYear(),
          dt.getUTCMonth(),
          dt.getUTCDate(),
          0,
          m,
          s.tz,
        ),
        en = st + s.len * 6e4;
      if (
        st >= now + s.notice * 36e5 &&
        st <= now + s.window * 864e5 &&
        !bk.some((b) => b.start < en + s.buf * 6e4 && b.end > st - s.buf * 6e4)
      )
        out.push(st);
    }
  }
  return out;
}
// ===== UI PARTS =====
// Southern Ontario (Lambert conformal conic, from Natural Earth 1:10m boundaries with
// lakes cut out). on: Ontario; nb: Quebec + neighbouring US states; cities: [x, y] pins.
const MAP = {
  w: 560,
  h: 400,
  on: "M295.7,-4L300.3,-3L303.3,-3L305,-2.6L306.5,-0.6L308.2,-0.5L311.2,-1.1L319.3,-0.3L323.4,1.8L331,2L343.2,5.5L347.1,6.4L358.8,12.3L362.6,15.5L365.7,17.2L367.1,19.1L368.9,20.6L370,22.3L370.5,27L371.2,28.5L374.1,31.9L377.2,34.7L379.6,36.3L387.2,40L390.4,40.6L392.1,40.1L393.2,38.5L393.2,37.4L392.4,33.5L392.7,32.2L394,31.4L396.8,31.1L399.2,31.8L400.5,32.7L401.6,35.5L401.8,39.4L402.2,41.2L403.4,44.5L405.2,45.4L406.4,47.4L407.1,51.5L409.1,55L410.4,58.6L412,59.9L413.6,60.7L419.7,62.1L422,63.1L423.8,63.4L425.2,64.2L428,66.7L429.5,67.5L431.3,67.7L432.9,67.4L435.2,65.8L436.1,63.9L436.8,63.2L441,62.3L442.7,62.2L447.6,63.3L449.3,64.1L450.2,65.6L453.3,67.2L455.6,70.3L456.3,70.8L458.3,73.2L460.9,74.2L465,73.5L466.4,72.2L469,67.9L470.5,66.7L472.1,66L476,65.5L490.2,59.2L493.2,57L494.8,56.1L509,53.8L510.8,52.8L514.2,50.3L516,49.8L526.1,49.8L530.9,48.7L532.8,47.4L534.1,47.3L535.4,48L537.8,49.8L540.4,51.2L543,52.1L545.9,52.1L549.9,53.9L545.9,76.8L553.9,84.4L554.5,84.9L553.5,86.2L550.5,88.5L548,89.2L545.7,91.9L544.7,93.8L543.9,96.9L542.6,97.9L536.2,101.6L532.6,105.6L530.8,105.7L522.9,105.1L520.7,105.6L518.5,107.3L514.9,108.8L511.2,111.7L506.9,113.3L498.3,119.1L487.1,130.4L472.3,145.1L469,150L466.8,152.8L465.5,152.2L463.5,153.7L457.6,161.6L455.6,163.1L453.4,164.1L448.4,164.9L447.2,165.4L443.5,168.1L439.2,168.3L437.7,169.4L434.7,170.3L433.2,172L428.5,174.6L425.7,176.5L424.1,175.2L422.5,177L419.9,178.3L415.3,178.6L414,177.5L412.6,178.6L410.3,179.2L407.8,180.6L404.2,183.3L401.5,184.1L398.4,187.5L395.6,189L394.2,190.1L393,192.1L388.5,193.1L389.3,191.4L387.9,191.4L386.7,190.8L390.9,185.9L394.6,184.1L397.1,184L397.6,182.5L396,180.8L389.8,186.2L388.1,186.4L388.3,184L388.9,182.4L390.9,180.3L390.2,179.7L388.6,179.9L380.3,183.9L378.1,183.9L376.8,182.3L375.5,182L373.9,183.7L371.7,184.4L370.4,183.3L367.2,184.1L358.9,188.1L355.9,188.5L354.9,189.4L354.2,190.7L354,192.5L356.2,191.5L360.1,188.7L363.1,187.9L364.8,186.3L366.5,186.3L371.8,185.6L370.1,186.8L371,188L369.7,189.8L370.5,190.9L371.8,190.9L374.5,189.7L372.3,189.2L372.2,188.6L374.5,186.4L375.5,186.1L379.4,186L382.2,184.6L386.9,182.8L385.4,189.7L384.4,192.5L382.9,195.1L383.7,195.1L387.4,193.8L390.8,194.5L396.3,191.3L398.2,189.2L400.7,188.4L398.3,191.5L397.6,194.2L396,195.9L392,197.7L390.4,199.2L390.6,200L389.2,201.5L388.7,202.8L389.7,204.2L391.3,202.2L393.4,203.1L398.7,201.8L400.7,202.3L400.2,203.8L397.4,203.9L393.1,206.3L386.2,209L384.3,211L383.4,211.4L381.2,211.4L381,210.2L377.7,210.1L376.6,209.7L380,204.8L380.8,202.9L378.4,204.6L375.3,206.2L372.5,206L370.8,202.6L373.5,204.1L374.7,203.8L375.6,201.8L373,203.1L371.2,201.7L368.6,202.1L363.6,203.8L361.1,204L360.2,203.7L355.6,200.3L356.2,199L357.6,197.9L353.2,195.5L352.2,195.5L349.4,196.3L348.5,196.8L347.5,195.8L346.3,195.7L344.5,197.4L347.9,198.3L348.5,199.2L345.7,198.9L341.7,197.8L340.3,198L333.8,201L327.7,201.4L326.5,201.8L310.1,203.6L301,206.2L297.3,208.4L295.9,208.7L290.8,207.6L289.2,207.5L285.2,209.1L276.2,210.9L273.4,212.1L271.9,212.3L267.2,211.9L265.6,212.3L261.5,215L258.5,215.3L256.7,216.6L255.5,219L254.1,220L251.3,221.7L246.2,226.5L242.4,229L240.3,231.3L235.5,230.6L233.9,230.9L231.5,235.1L228.8,236L226.3,237.6L225.5,238.7L225,240.7L224.4,244.4L220.1,251.3L215.8,256L214.1,258.9L214.2,262.2L216.3,264.9L219.3,266.7L225.7,269L228.8,269.6L235.3,269.3L238.5,269.7L241.2,271.1L242.6,271.5L245.2,269.7L249.1,268.1L252.7,265.4L258.9,264.4L260.2,263.8L260.5,265.4L260.8,273.3L260.6,275.4L259.7,277.8L259.7,279.1L259,280.5L261.8,283.5L261.1,286L261.1,287.5L262.6,289.3L265.8,291.8L268.6,293.2L269.3,294.5L268.7,296.3L266.1,298.2L258.9,299.9L257.7,301.7L256.5,301.3L253.7,299.6L250.7,299L239.9,299.5L234.9,298.8L234,299L232.4,300.6L231.7,300.8L226.3,300.4L224.5,300.6L222.1,301.8L217.3,299.8L213.6,301.4L212.2,301.7L209.7,302.8L207.1,302.7L186.7,306L183.8,307.2L180.1,310.9L178.1,312.2L177,315.8L175.4,316.5L174.7,314.9L172.4,316.4L169.8,319.4L169.1,321L169.7,322.7L176.4,322.5L177.2,323.8L179,324.4L192.3,325.6L194.8,326.8L192.8,327.2L191.4,328.2L188.6,327.3L182.2,326.6L177,324.9L175.2,324.6L165.3,325L161,323.3L152.8,321.2L149.5,319.1L148,318.9L138.1,316L118.8,315.2L110.3,316.7L106.4,319.2L102.3,320.8L100.5,322.3L98.2,323.2L91.8,329.1L90.4,330.8L81.2,337.3L79.7,339.7L79.4,341.3L78,344.5L77.4,348.5L76.6,350.1L75.4,350.8L73.9,350.2L74.6,348.6L76.6,346.3L76.9,344.2L71.8,347.6L72.2,349.5L63.2,349.3L61.6,349.8L59.1,351.4L42.5,359.5L41.3,360.4L36.5,365.5L34.4,368.1L33.3,375.2L32.7,377.5L30.2,372.2L28.1,369.5L25.5,367.5L22.6,366.8L19.6,367.4L11.7,371.1L8.8,371.4L5.8,370.8L3.3,369.4L1.4,367.5L-0.8,366.8L-2.6,365.4L-4,365L-4,344.1L-4,344.1L-3.2,342.5L0.1,340.4L1.5,341.3L4,339.7L5.6,339.4L12.1,341L16.8,342.9L26.4,343.3L29.8,342.2L36.1,342.5L38.8,341.4L40.8,337.8L41.1,335.9L40.5,332.1L39.8,330.6L40.4,329.9L40.9,327.5L39,327.4L37.6,328.6L36.4,326.6L34.1,325.8L29.5,325.8L26.8,322.9L26.3,321.5L28.6,321.3L30.8,320.4L32.6,318.8L34.2,316.3L35.3,314L37.4,307.7L38.5,302.3L38.4,300.7L37.7,298.9L38,297.4L39,294.9L40.2,290.1L41.8,287.3L42.9,284.5L43,281.5L45.5,281.2L60.3,275.9L62.7,274.5L64.1,273.4L70.2,265.4L71.5,264.5L73.8,264.2L76.6,262.5L78.4,261.8L85,256L87,253.8L88.5,251.1L89.9,247L90.6,243.2L90.9,239.4L90,224.4L90.8,209.2L91.5,203.6L91.5,201.6L90.6,196.5L90,189L90.3,187.6L91.4,186.1L95.4,182.6L98.5,177L100.2,172L100.5,170.6L100.2,167.8L101.1,166.2L102.8,165.6L103.7,164.5L106.7,160L107.9,159.2L110.9,158.7L112.2,158.1L112.9,156.8L113.6,153.3L114.3,151.7L120.8,143.8L121.5,142.3L121.8,140.4L121.6,138.8L119.8,135.2L121.5,133.7L121.4,130.8L120.9,127.7L121.4,125.6L120.9,124.8L118.8,123.6L118.4,120.3L116.5,118.7L116.4,115.9L116.9,112.8L117.6,110.9L115.6,108.5L114.2,109.6L113,108.8L112.3,109.6L110.6,104.2L109.5,103.5L109.2,102L108,100.8L107,98.4L105.7,97.7L104.1,94.9L102.7,94.6L103.9,92L102.4,92.2L101.6,91.5L99.8,91L99.1,89.6L96.6,90.2L95.7,89.6L95.2,88.2L95.5,87L97,86.5L96.6,85.1L98.3,84.8L99.7,83.8L100.9,84.3L100.9,85.5L102.2,86L121.2,86.6L122.6,88L122.1,89.5L119.9,91.9L119.4,93.7L119.8,95.8L122.2,98.2L123.1,99.5L123.2,101.2L122.8,107.1L123.3,108.9L126.3,107.5L127.5,108.2L126.8,111.2L132,112.4L132.2,113.5L131.4,114.9L129.9,116.1L129.9,116.7L132.6,115.9L133.8,116L133.7,117.5L134.8,117.3L136.1,115.9L137.2,115.7L136.5,113.8L137.4,112.5L138.9,111.7L140.3,111.5L142.3,112.2L141.7,113.4L140,114.8L138.9,116.4L138.8,117.4L139.2,120.3L138.7,121.8L136.7,124.4L135.7,125.1L131.5,127.5L130.6,129L130.6,130.2L131.3,131L134,128.5L136.9,126.6L139.9,125.9L143,126.4L145.3,128.2L145.8,131.7L142.1,142.5L142.4,145.6L149.6,137.2L153.6,134.7L158.8,133.9L161.4,135L162.3,137.5L162.7,140.6L163.8,143.4L165.1,144.5L169.2,145.1L170.2,145.8L172.9,148.8L174.5,149.4L178.3,150.1L180.8,152L185.8,152.6L189,154.2L191.7,156.1L194.4,157.2L197,155.9L199.3,153.8L200.5,152.3L201,150.8L201.1,143.8L202,138.1L201,136.7L198.6,134.3L194.9,132L194.5,130.7L194.5,128.3L194.9,126.5L196.2,126.1L197.9,126.8L198.8,126.2L200,123.5L202.7,122.7L205.1,122.5L206.6,123.2L207,124.2L205.3,127L206.3,127.5L208.9,127.6L209.6,128L209.1,130.4L209.6,131.4L214,131.3L214.6,132.5L216.4,131.7L218,132.8L222.8,132.6L222.3,131.7L219.2,129.8L219,128.6L219.7,127.4L221.4,125.6L221.9,123.4L221.2,121.1L218.2,122.8L219.6,124.5L219.4,126.3L218.1,127.6L216.4,127.7L215.4,126.9L216,124.6L215.6,123.4L213,122.1L214.8,121L212.4,118.5L212.7,116.1L211.2,115.6L209.9,114.3L207.6,115.4L206.4,114.4L206.4,111.2L205.5,109.2L202.9,108.7L202.2,107.8L202.2,106.1L201.2,104.7L198.7,103.8L197.1,101.9L197.2,101L195.9,98.9L198,99.5L200.2,99.6L201.9,98.8L202.3,96.6L200.4,93.6L199.3,93.5L198.1,91.5L196.2,93.2L195.3,93.5L195.1,91.9L195.5,91L194.3,90L194.6,88.6L195.7,87.3L197.8,86.1L200.4,82L199.7,79.7L198.3,78.3L198.5,76.3L197.3,75L195.4,74.4L193.7,74.6L191.9,75.2L190.7,76.9L190.8,78L192,79L192,80.5L188.2,79.6L186.6,78.1L183.8,78.2L183.4,77.1L183.3,73.8L183.9,72.5L182.1,71.9L182.1,75.5L181,76.5L179.6,74.3L180.5,73.1L180.2,71.9L178.5,69.5L178.2,66.5L179,62L178.9,60.1L178.2,58.5L177.7,55.8L176.7,56.3L176.5,58.4L174.4,58.4L172.2,59.7L171.4,59.6L171.1,57.4L170.2,57.1L170.8,54.5L170.4,53.8L168.3,53.2L167,51.6L167.4,50.4L165.3,49.7L166.6,48.5L164.7,47.2L163.3,44.9L163.1,43.5L163.8,41.4L161.8,39.1L161.6,37.6L160.7,37.7L159.2,37L159.1,35.4L160.5,35.7L161.3,34.7L158.5,33.8L158,32.9L157.7,30.3L156.9,28L155.9,27.7L154.8,29.1L154.1,28.8L153.7,25.2L152.9,26.4L150.9,27.2L149.8,26.9L148.4,25.3L146,26.2L144.6,26.1L140.5,24.9L138.1,24.8L131.8,26.4L130.9,25.6L131.8,22.7L131.8,21L129.8,22.5L127.8,23.4L125.7,23.6L117.5,21.5L116.2,20.7L114.6,20.5L112.8,21.5L110.7,21.5L111,18.5L108.7,19.6L102.3,23.7L100.1,24.1L105.8,20.6L107,19L104.6,18.9L102.4,18.2L104.4,17.2L108.9,16.9L110.9,16L101.1,16.8L106.3,15.4L108.9,14.1L108.2,13.1L108.6,11.3L105.6,10.4L104,8.5L103.1,8.6L101.6,10.4L101,12.5L100.2,12.9L96.5,13.1L96.6,14.7L95.1,17.9L94.4,16.6L94.1,14.3L95,12.6L98,10.7L98,10.1L80,8.8L75.6,6.9L74.2,6.7L72.6,8.1L71.4,7.3L70,7.4L68.3,5.6L66.7,4.7L63.6,3.9L61.3,4.4L59.3,3.4L57.9,2.3L59.5,1.7L61.8,1.9L61.5,0.7L60.5,0.9L56.6,0.5L53.5,1.3L54,-0.3L52.1,-0.1L48.2,1.4L40.1,2.2L38.7,1.5L39.7,0.2L42.2,-1.3L42.7,-2.5L37.8,-0.6L24.1,-0.4L20.9,0.6L17.1,-0.2L15.2,-1L13.7,-2.3L12,-1.4L5.1,-3.1L3,-4L295.7,-4ZM95.8,81.6L94.7,81.4L92.5,79.7L94.5,78.9L95.7,79.8L96.8,79.8ZM90.5,67.3L88.4,65.6L89.6,63.2L90.8,62.7L92.7,61.2L97.1,60.4L95.1,64.9L92.9,67ZM85.3,18.3L83.5,17.5L82.8,16.2L82.9,15L84.2,14.4L88.5,13.9L89.9,14.7L90.6,13.8L92.7,14.3L93.3,15.4L92.3,17.2L92.9,17.7L93.1,19.3L92,20.7L90.6,18.9L87.7,18.8L86.7,19.4ZM35.1,22.8L36.4,22.7L36.4,20.7L38.2,19.9L41.6,19.2L44.8,20.3L44.9,21.8L42.9,25L39.6,25.8L36.3,24.9ZM-4,15L-3.7,14.9L-2.6,14.8L0.3,18.3L2.2,18L2.4,18.8L2.4,18.8L1.9,22.1L1.3,23.3L-1.4,26.2L-3.4,27.3L-4,27.1L-4,15ZM99.8,27.8L100.7,28.1L101.2,29.6L100.9,32.2L99.8,34.1L97.5,37.4L104.1,37.1L105.1,37.6L105,38.8L103.9,41.8L100.1,45.4L101,46L97.1,51L96.1,53.1L94.1,54.9L90.9,59.6L88.6,61.3L85.5,60.9L84.1,60L83.2,57.3L80.7,58.2L79.3,58L80.2,56.5L81.7,55.2L83.4,54.3L85.2,55.7L88.6,51.9L90.7,51.1L92.3,48.7L94.2,48L94.6,46.6L93.6,45.5L91.9,46.3L89.1,47L87,48.9L85,51.3L82.9,53.3L80,53.9L77.9,57.1L75.9,57.2L74.6,57.8L74,56.2L72.6,55.8L72.9,54L71.7,53.3L68.3,53.2L66.2,51.3L63.5,50L62.4,47.4L61.3,46.9L59.9,47.6L59.2,47.1L58.4,45.1L51.4,43.9L50.3,43.2L48.2,40.5L46.7,39.7L40.5,38L39.2,37.2L37.6,35.3L36.1,35.1L35.4,36L33.7,34.6L32.5,35.6L31.1,34.7L28.5,34L27.9,33.1L26.4,34.2L24.8,33.9L23,33.1L21.1,32.8L21.4,31.1L20.4,30.4L17.6,30.2L16.3,29.1L15,28.8L13.4,27.5L10.6,26.9L7.1,26.7L4.7,25.4L4.8,21.6L5.7,20.1L7.2,18.5L8.8,17.8L10.2,18.6L11.5,19.9L11.8,22.4L12.5,22.5L14.2,20.8L15.5,19.1L18,20.1L18.5,21.4L20.9,21.6L21.8,19.4L24.4,18.6L27.1,18.5L28.5,17.1L30.7,17.4L30.2,19.3L28.7,22.7L28.6,24.1L29.9,25.7L32.1,26.4L33.1,30.4L34.3,30.6L37.4,29.2L39.3,29.1L40,31.6L40.6,31.9L42.4,30.2L43.8,31L45.6,33.6L46,35.6L47.5,34.8L48.5,32.9L48.7,31.2L47.2,29.9L45.3,30.4L45.9,28.6L44.1,27.9L43.6,27.2L44.4,25.5L46.9,25L48.5,22.5L50.1,21.9L51.3,23.3L52.2,23.4L53.6,20.9L56.1,20.4L61.4,19.1L62.1,19.3L62.1,22.9L62.7,24.4L64.1,24.1L66.8,22.8L66.6,24.6L67.3,26.9L69.4,30.2L69,32L70,32.3L71.3,31.4L72.4,27.9L73.1,26.2L74.8,23.7L77.4,21.7L80.3,20.3L83.2,20.2L85.8,21.8L86.7,23.4L85.6,27.5L86.3,28.4L89.8,28.8L91,29.9L91,31.6L89.5,35.3L89.2,37.8L91.4,42L92.5,42.1L92.4,39L92.8,37.4L95.1,33L98.9,28.3ZM64.9,14.8L66,13.3L67.7,13.8L68,17.1L67.7,18.6L64.8,16.5ZM188.6,83.1L191,81.2L192.8,82.3L194.6,82.2L195.9,80.5L196.8,80L198.7,81.3L196.3,85.1L191.1,89.1L189.7,88.4L188.8,86.6L188.2,84.4ZM191.7,124.5L190.7,126.1L190,128.9L188.6,127.5L187.2,125.5L186.4,123.5L186.9,121.7L188.2,122.6L191.4,122.1L192.4,123ZM23.3,393.1L21.6,394.3L20.2,394.2L20.1,393.2L20.4,388.7L20.9,387.6L23.2,386.3L23.9,392ZM413.9,182.8L412.8,184L410.1,187.4L408,187.8L405.3,187.7L403,186.9L402.9,185.3L404.2,184.2L409.1,182.4L412.6,180.7L414.1,180.8ZM434.4,172.3L436.5,170.9L438.9,170.2L441.8,169.9L439.1,172.9L436.8,173.9L431.9,174.5ZM428.7,186L427.2,187.4L425.7,186.8L424.2,187L424.9,185L422.8,184.9L422.9,183.4L425.3,179.8L426.8,179.1L429,179.3L431.2,180.1L432.3,181.1L430.5,183.6L431.8,184.2ZM428,178.3L431.6,176.9L437.2,176.7L438.9,176.2L442.3,176L442,177.2L440.4,178.2L438.4,178.6L428.7,178.9Z",
  nb: [
    "M564,58.4L562.7,57.1L561.2,56.9L555.5,57.8L551.7,55.6L554.2,59.3L557.4,59.7L564,61.6L564,78.6L564,78.6L563.4,79.8L561.3,80.8L556.9,83.7L554.5,84.9L553.9,84.4L545.9,76.8L549.9,53.9L545.9,52.1L543,52.1L540.4,51.2L537.8,49.8L535.4,48L534.1,47.3L532.8,47.4L530.9,48.7L526.1,49.8L516,49.8L514.2,50.3L510.8,52.8L509,53.8L494.8,56.1L493.2,57L490.2,59.2L476,65.5L472.1,66L470.5,66.7L469,67.9L466.4,72.2L465,73.5L460.9,74.2L458.3,73.2L456.3,70.8L455.6,70.3L453.3,67.2L450.2,65.6L449.3,64.1L447.6,63.3L442.7,62.2L441,62.3L436.8,63.2L436.1,63.9L435.2,65.8L432.9,67.4L431.3,67.7L429.5,67.5L428,66.7L425.2,64.2L423.8,63.4L422,63.1L419.7,62.1L413.6,60.7L412,59.9L410.4,58.6L409.1,55L407.1,51.5L406.4,47.4L405.2,45.4L403.4,44.5L402.2,41.2L401.8,39.4L401.6,35.5L400.5,32.7L399.2,31.8L396.8,31.1L394,31.4L392.7,32.2L392.4,33.5L393.2,37.4L393.2,38.5L392.1,40.1L390.4,40.6L387.2,40L379.6,36.3L377.2,34.7L374.1,31.9L371.2,28.5L370.5,27L370,22.3L368.9,20.6L367.1,19.1L365.7,17.2L362.6,15.5L358.8,12.3L347.1,6.4L343.2,5.5L331,2L323.4,1.8L319.3,-0.3L311.2,-1.1L308.2,-0.5L306.5,-0.6L305,-2.6L303.3,-3L300.3,-3L295.7,-4L564,-4ZM564,103.8L552.4,104.6L533.7,105.6L532.6,105.6L537.4,104L547.3,98.8L549.5,97L551.2,94.4L551.5,91.7L554.2,90.3L555.7,88.6L557,88L562.5,86.5L563.7,85.8L564,85.5L564,103.8Z",
    "M-4,97.8L-2.6,98.6L-2.1,100.2L-4,100L-4,97.8ZM-4,193.1L-0.9,193.1L1.4,191.7L4.4,191.3L5.5,190.7L7.9,188.2L12.1,186.8L15,186.9L21.9,191.2L24.1,193.1L26.1,195.3L29.2,200.8L29.6,202.3L30,205.4L32.1,210.7L34.5,235.9L36.3,242.8L36.9,258.3L39.5,273.8L40.5,275.6L43,281.5L43,281.5L42.9,284.5L41.8,287.3L40.2,290.1L39,294.9L38,297.4L37.7,298.9L38.4,300.7L38.5,302.3L37.4,307.7L35.3,314L34.2,316.3L32.6,318.8L30.8,320.4L28.6,321.3L26.3,321.5L26.8,320.5L28.7,319.7L26.9,317.8L27.8,316.3L26.6,314.1L27.6,311.6L27.7,310.6L26.4,310.5L22.9,308.5L18.8,311.5L15.6,312.6L15.6,314.4L16.5,316.3L18.1,317.3L17.2,318.9L15.7,319L12.8,320.1L12,320.8L10.7,324.4L10.5,326.1L11.1,328.3L11,330.3L9.6,334.3L8.5,335.6L6.3,337.4L3.6,337.9L-0.6,339.3L-2,340.4L-4,342.7L-4,193.1Z",
    "M100.9,404L108.3,398.1L129.9,388.5L134.5,387.7L136.2,386.7L138.6,386.3L140.4,384.5L144.1,383.9L146.3,382.4L163.5,377L163.5,377L163,402.6L162.9,404L100.9,404Z",
    "M162.9,404L163,402.6L163.5,377L166.9,376L168.9,374.5L173.1,373.8L184.1,367.9L186,366.3L187.3,365.6L188.2,363.6L192.1,360.8L193.6,361.4L192.3,362.5L190.7,362.5L189.1,364.3L190.7,364.5L193.9,362.5L196.8,361.5L199.7,359L202.5,358.2L205.4,356.1L213.7,352.7L213.7,352.7L213.4,376.5L233.7,376.7L251.6,376.9L269.4,377L296.3,377L323.1,376.9L350,376.7L367.9,376.4L385.8,376.1L403.7,375.8L421.6,375.4L439.4,374.9L457.3,374.4L475.2,373.8L493.1,373.1L504.3,372.7L504.3,373.9L506,375L509.5,376.8L509.9,378.4L510.6,382.6L511.8,383.4L515.4,382.6L517.7,384.1L519.5,384.7L520.6,386.3L522.1,386.9L520.4,389.7L523,390.8L523.8,391.6L524.2,393.5L523,396L524,399.3L523.9,404L162.9,404Z",
    "M523.9,404L524,399.3L523,396L524.2,393.5L523.8,391.6L523,390.8L520.4,389.7L522.1,386.9L520.6,386.3L519.5,384.7L517.7,384.1L515.4,382.6L511.8,383.4L510.6,382.6L509.9,378.4L509.5,376.8L506,375L504.3,373.9L504.3,372.7L493.1,373.1L475.2,373.8L457.3,374.4L439.4,374.9L421.6,375.4L403.7,375.8L385.8,376.1L367.9,376.4L350,376.7L323.1,376.9L296.3,377L269.4,377L251.6,376.9L233.7,376.7L213.4,376.5L213.7,352.7L217.6,350.5L222.6,346.6L227,345L229.2,342.7L232.9,340.7L236,336.5L238,335.6L239.7,333.4L243.6,331.7L247,329.4L248.4,327.6L252.7,326.3L253.9,325.5L256.1,321.4L257.5,320.8L258.5,319.2L259.9,316L261.7,313.7L264.2,312.2L269.3,309.9L271.6,307.9L272.2,306.3L272.4,302.1L271.9,300.2L270.2,296.6L269.7,292.7L268,290.2L268.5,288.3L270.8,285.8L271.1,283.9L269.4,281.7L262.2,280.8L259.7,279.1L259.7,279.1L259.7,277.8L260.6,275.4L260.8,273.3L260.5,265.4L260.2,263.8L264.6,263L272.9,259.8L279.8,258.5L284,256.5L303.8,253.4L313.7,254.8L321.4,253.5L344.5,257.6L346.1,258.4L346.1,259.3L347.9,259.8L352.5,264L355.2,265.2L358.1,265.2L366.2,262.1L369.1,261.4L393.8,262.2L393.4,263.4L394.4,264.5L396.2,264.3L396.5,261.7L397.2,260.6L403.8,259.1L407.9,257.1L408.6,255.7L411.1,257L413.9,251.3L416.1,249L418.5,247.2L425.1,243.7L426.3,242.7L429.5,239.2L430.7,239L433.4,239.9L435,240.2L439.3,239.2L440.6,238.5L443,235.3L444.2,234.1L442.4,232.9L442.7,230.9L445.3,226.8L443.7,226.6L442.7,228.7L441.9,224.6L441.9,222.6L442.4,220.8L441.3,217.3L440.4,215.7L439.7,213.3L436.1,210.3L437.7,208L440.8,206.4L439.9,208.8L441.7,210L442.4,208.7L445.1,206.2L446,204.8L446.7,201.3L447.5,200.4L449.6,200L451.3,198.3L450.9,196.6L448.8,196.8L447.1,198.5L446,198.9L442,199L441.6,198.6L443.3,196.4L444.9,195.5L446.5,193.4L445.5,191.6L444.6,190.7L442.1,191.2L441.5,190L437.4,192.2L436.7,194.5L435.1,194.3L435.4,192.4L435.1,191.4L433.9,190.3L431.9,189.4L431.5,187.5L432,186.3L442.8,177.8L450.9,173.8L458.9,166.3L459.8,164.8L463,163.3L463.7,161.4L467.6,158.5L468.3,157.2L467.6,154.1L466.8,152.8L469,150L472.3,145.1L487.1,130.4L498.3,119.1L506.9,113.3L511.2,111.7L514.9,108.8L518.5,107.3L520.7,105.6L522.9,105.1L530.8,105.7L532.6,105.6L533.7,105.6L552.4,104.6L564,103.8L564,404ZM265,290.3L262.5,287.5L263.3,283.9L263.2,282.6L266.6,282.2L269.2,283.3L269.5,285.2L266.2,290.5ZM450.8,167.2L452.1,167.2L453.5,165.9L454.3,167.1L455.7,164.5L456.8,165.2L458.5,163.4L459.4,163.7L458.3,165.9L455.7,168.4L454.6,168.9L452.8,170.6L451.7,170L451.7,168.2ZM444.2,172.3L445.1,171L449.6,169.7L450.1,170.9L448.6,171.7L446.3,173.7L444.3,173.8ZM441.2,194.8L440.5,196.8L439.7,197.9L437.5,199.8L437.2,197L438.7,194.9L440.7,193.8Z",
  ],
  cities: {
    London: [116.8, 285],
    Waterloo: [164.9, 245.4],
    Hamilton: [204.7, 264.8],
    Toronto: [238.8, 229.6],
    Kingston: [423, 178.2],
    Ottawa: [470.6, 70.7],
  },
  lakes: [
    ["Lake Huron", [55.8, 159.7]],
    ["Georgian Bay", [152.6, 83.3]],
    ["Lake Erie", [119.5, 352.3]],
    ["Lake Ontario", [352, 252]],
  ],
};
const uniMap = () => {
  const by = {};
  C.unis.forEach(([n, c]) => (by[c] = by[c] || []).push(n));
  const pins = Object.entries(MAP.cities).filter(([c]) => by[c]);
  return `<figure class="umap"><svg viewBox="0 0 ${MAP.w} ${MAP.h}" role="img" aria-labelledby="umt"><title id="umt">Map of southern Ontario marking ${C.unis.length} universities where Cultivar+ tutors study</title>${MAP.nb.map((d) => `<path class="nb" d="${d}"/>`).join("")}<path class="ont" d="${MAP.on}"/>${MAP.lakes.map(([n, [x, y]]) => `<text class="lake" x="${x}" y="${y}">${n}</text>`).join("")}<g class="pins">${pins.map(([c, [x, y]], i) => `<g class="pin" data-c="${c}" style="--i:${i}" transform="translate(${x} ${y})"><circle class="ring" r="15"/><circle class="dot" r="6.5"/><text class="city" x="12" y="5">${c}${by[c].length > 1 ? `<tspan dx="5">${by[c].length}</tspan>` : ""}</text><title>${c}: ${by[c].join(", ")}</title></g>`).join("")}</g></svg></figure>`;
};
// Blossom frame: intertwined bark branches wrapped around the map panel's edge, with
// pale blossoms at the corners and along the sides. Built from the panel's measured
// size so it fits any width; rebuilt on resize without replaying the growth.
let frameGrown = false,
  frameRO = null;
function blossomFrame() {
  const box = $(".uwrap"),
    panel = box && box.querySelector(".unis");
  if (!panel) return;
  const w = panel.offsetWidth,
    h = panel.offsetHeight;
  if (!w || !h) return;
  const small = w < 480,
    M = small ? 44 : 70,
    W = w + 2 * M,
    H = h + 2 * M,
    R = 28,
    sc = small ? 0.62 : 1;
  let seed = 7; // seeded, so every rebuild draws the same frame
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // point + outward normal at distance s, clockwise around the panel's rounded rect
  const x0 = M,
    y0 = M,
    sw = w - 2 * R,
    sh = h - 2 * R,
    arc = (Math.PI * R) / 2;
  const P = 2 * sw + 2 * sh + 4 * arc;
  const corner = (cx, cy, a0) => (u) => {
    const a = a0 + u / R;
    return [
      cx + R * Math.cos(a),
      cy + R * Math.sin(a),
      Math.cos(a),
      Math.sin(a),
    ];
  };
  const segs = [
    [sw, (u) => [x0 + R + u, y0, 0, -1]],
    [arc, corner(x0 + w - R, y0 + R, -Math.PI / 2)],
    [sh, (u) => [x0 + w, y0 + R + u, 1, 0]],
    [arc, corner(x0 + w - R, y0 + h - R, 0)],
    [sw, (u) => [x0 + w - R - u, y0 + h, 0, 1]],
    [arc, corner(x0 + R, y0 + h - R, Math.PI / 2)],
    [sh, (u) => [x0, y0 + h - R - u, -1, 0]],
    [arc, corner(x0 + R, y0 + R, Math.PI)],
  ];
  const at = (s) => {
    s = ((s % P) + P) % P;
    for (const [len, f] of segs) {
      if (s <= len) return f(s);
      s -= len;
    }
    return segs[0][1](0);
  };
  // distance along the perimeter to the start of each side
  const sTop = 0,
    sRight = sw + arc,
    sBottom = sw + 2 * arc + sh,
    sLeft = 2 * sw + 3 * arc + sh;
  const f1 = (n) => n.toFixed(1);
  const smooth = (pts, closed) => {
    const n = pts.length,
      g = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = g(i - 1),
        b = g(i),
        c = g(i + 1),
        e = g(i + 2);
      d += `C${f1(b[0] + (c[0] - a[0]) / 6)} ${f1(b[1] + (c[1] - a[1]) / 6)} ${f1(c[0] - (e[0] - b[0]) / 6)} ${f1(c[1] - (e[1] - b[1]) / 6)} ${f1(c[0])} ${f1(c[1])}`;
    }
    return d + (closed ? "Z" : "");
  };
  // a branch wanders in and out across the panel's edge
  const branch = (start, span, base, amp, cycles, ph) => {
    const closed = span >= 1,
      n = Math.max(8, Math.round((span * P) / 16)),
      pts = [];
    for (let k = 0; k < (closed ? n : n + 1); k++) {
      const s = start * P + (k / n) * span * P,
        [x, y, nx, ny] = at(s),
        o =
          (base + amp * Math.sin((2 * Math.PI * cycles * s) / P + ph)) * sc +
          (rnd() - 0.5) * 2;
      pts.push([x + nx * o, y + ny * o]);
    }
    return smooth(pts, closed);
  };
  const branches = [
    // start, span, offset, amplitude, cycles, phase, width
    [0.02, 1, 4, 13, Math.max(3, Math.round(P / 300)), 0, 34],
    [0.52, 1, 2, 17, Math.max(4, Math.round(P / 210)), 1.7, 24],
    [0.27, 1, 10, 10, Math.max(3, Math.round(P / 360)) + 1, 3.1, 14],
    [0.14, 0.4, 16, 16, 3, 0.6, 10],
    [0.64, 0.38, -2, 18, 3, 2.2, 9],
  ].map(([st, sp, b, a, c, ph, wd]) => [branch(st, sp, b, a, c, ph), wd * sc]);
  // blossoms: corners pushed outward so the petals stay clear of the content
  const spots = [];
  const o = small ? 12 : 22;
  spots.push(
    [x0 - o, y0 - o, 1.35, 0],
    [x0 + w + o, y0 - o * 0.4, 1.18, 2],
    [x0 + w + o * 0.7, y0 + h + o, 1.4, 5],
    [x0 - o, y0 + h + o * 0.6, 1.25, 7],
  );
  const side = (s, out, k, ord) => {
    const [x, y, nx, ny] = at(s);
    spots.push([x + nx * out * sc, y + ny * out * sc, k, ord]);
  };
  side(sTop + sw * 0.64, 22, 0.92, 1);
  side(sRight + sh * 0.34, 26, 1.05, 3);
  side(sRight + sh * 0.72, 22, 0.88, 4);
  side(sBottom + sw * 0.44, 24, 0.98, 6);
  side(sLeft + sh * 0.32, 26, 0.95, 8);
  if (!small) side(sLeft + sh * 0.7, 22, 0.84, 9);
  const petal =
    "M0 -2C-20 -8 -31 -30 -19 -46C-12 -55 -4 -53 0 -47C4 -53 12 -55 19 -46C31 -30 20 -8 0 -2Z";
  const blossom = ([x, y, k, ord]) => {
    const r = Math.round(rnd() * 72),
      d = (0.5 + ord * 0.16).toFixed(2);
    const stamens = [...Array(7)]
      .map((_, q) => {
        const a = ((q / 7) * 360 + rnd() * 20) * (Math.PI / 180),
          L = 13 + rnd() * 6;
        return `<line x1="0" y1="0" x2="${f1(Math.cos(a) * L)}" y2="${f1(Math.sin(a) * L)}"/><circle cx="${f1(Math.cos(a) * L)}" cy="${f1(Math.sin(a) * L)}" r="1.6"/>`;
      })
      .join("");
    return `<g transform="translate(${f1(x)} ${f1(y)})"><g class="fr-bl" style="--d:${d}s"><g class="fr-sw" style="--sw:${(6 + rnd() * 4).toFixed(1)}s"><g transform="rotate(${r}) scale(${(k * sc).toFixed(2)})"><g filter="url(#fr-wc)">${[0, 72, 144, 216, 288].map((a) => `<path class="fr-pt" transform="rotate(${a})" d="${petal}"/>`).join("")}</g><circle class="fr-ctr" r="7"/><g class="fr-st">${stamens}</g></g></g></g></g>`;
  };
  // draw order: shadow, branches, blossoms west of the content first
  const svg = `<svg class="frame${frameGrown ? " settled" : ""}" viewBox="0 0 ${W} ${H}" style="left:${-M}px;top:${-M}px;width:${W}px;height:${H}px" aria-hidden="true">
<defs>
<linearGradient id="fr-bark" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}"><stop offset="0" stop-color="#55515a"/><stop offset=".4" stop-color="#7a757e"/><stop offset=".7" stop-color="#47444b"/><stop offset="1" stop-color="#66626a"/></linearGradient>
<radialGradient id="fr-petal" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#d996aa"/><stop offset=".35" stop-color="#efc6d2"/><stop offset=".75" stop-color="#fbe7ed"/><stop offset="1" stop-color="#fff5f8"/></radialGradient>
<filter id="fr-barkf" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.018 0.05" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${small ? 5 : 10}" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency="0.09 0.05" numOctaves="4" seed="12" result="bump"/><feDiffuseLighting in="bump" surfaceScale="2.6" lighting-color="#e6e0e8" result="lit"><feDistantLight azimuth="225" elevation="48"/></feDiffuseLighting><feComposite in="lit" in2="d" operator="arithmetic" k1="1.25" k2="0" k3="0" k4="0"/></filter>
<filter id="fr-wc" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="fr-sh" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${small ? 4 : 7}"/></filter>
</defs>
<g class="fr-shadow" filter="url(#fr-sh)">${branches
    .slice(0, 3)
    .map(
      ([d, wd]) =>
        `<path d="${d}" stroke-width="${f1(wd + 14)}" transform="translate(0 8)"/>`,
    )
    .join("")}</g>
<g class="fr-branches" filter="url(#fr-barkf)">${branches.map(([d, wd], i) => `<path class="fr-b fr-ol" style="--i:${i}" d="${d}" stroke-width="${f1(wd + 5)}"/><path class="fr-b" style="--i:${i}" d="${d}" stroke-width="${f1(wd)}"/>`).join("")}${branches
    .slice(0, 2)
    .map(
      ([d, wd], i) =>
        `<path class="fr-hl" style="--i:${i}" d="${d}" stroke-width="${f1(Math.max(1.5, wd * 0.14))}" transform="translate(-1.5 -${f1(wd * 0.22)})"/>`,
    )
    .join("")}</g>
<g class="fr-blossoms">${spots.map(blossom).join("")}</g></svg>`;
  box.querySelector(".frame")?.remove();
  box.insertAdjacentHTML("beforeend", svg);
  frameGrown = true;
  if (!frameRO) {
    let last = w + "x" + h,
      t;
    frameRO = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const p = $(".uwrap .unis");
        if (!p) return;
        const now = p.offsetWidth + "x" + p.offsetHeight;
        if (now !== last) {
          last = now;
          blossomFrame();
        }
      }, 120);
    });
  }
  frameRO.disconnect();
  frameRO.observe(panel);
}
function uniHover() {
  const box = $(".unis");
  if (!box) return;
  const hl = (c, on) =>
    box
      .querySelectorAll(`[data-c="${c}"]`)
      .forEach((e) => e.classList.toggle("hot", on));
  box.querySelectorAll("[data-c]").forEach((e) => {
    e.addEventListener("pointerenter", () => hl(e.dataset.c, true));
    e.addEventListener("pointerleave", () => hl(e.dataset.c, false));
  });
}
const bloomSvg = () =>
  `<svg class="bloom" viewBox="-60 -60 120 120" aria-hidden="true"><defs><linearGradient id="bg1" x1="0" x2="1"><stop offset="0" stop-color="#6f2232"/><stop offset="1" stop-color="#c50337"/></linearGradient></defs><g fill="url(#bg1)">${[0, 90, 180, 270].map((r) => `<path transform="rotate(${r})" d="M0 -8C-26 -22 -22 -54 0 -56C22 -54 26 -22 0 -8Z"/>`).join("")}</g><circle r="11" fill="#ff6a8c"/></svg>`;
const av = (t, c = "av") =>
  t.photo
    ? `<img class="${c} ph" src="${esc(t.photo)}" alt="${esc(t.name)}">`
    : `<div class="${c}" aria-hidden="true">${esc(t.name[0])}</div>`;
const tags = (a) =>
  `<div class="tags">${a.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>`;
const tcard = (t) =>
  `<article class="tc">${av(t)}<h3>${esc(t.name)}</h3><p class="uni">${esc(t.uni)} · ${esc(t.program)}</p>${tags(t.subjects)}<p class="vibe">${t.vibe.map(esc).join(" · ")}</p><p class="bio">${esc(t.bio.length > 110 ? t.bio.slice(0, 110) + "…" : t.bio)}</p><div class="row between"><b>${money(rateOf(t))}<small>/hr</small></b><span class="row" style="gap:8px"><a class="btn alt sm" href="#tutor-${t.id}">Profile</a><a class="btn sm" href="#book" data-track="book" onclick="pick('${t.id}')">Book</a></span></div></article>`;
function pick(id) {
  Object.assign(st, {
    tutor: id,
    subject: null,
    slot: null,
    day: null,
    month: null,
    step: 1,
    ref: null,
  });
}
function fx() {
  const els = [
    ...document.querySelectorAll(
      "#app .about .split>*,#app .tc,#app .band,#app .q,#app .steps,#app .steps>div,#app details,#app .help>div,#app .cta .wrap>*,#app section>.wrap>h2",
    ),
  ];
  els.forEach((e) => {
    e.classList.add("rv");
    const p = e.parentElement,
      i = [...p.children].indexOf(e);
    e.style.setProperty("--d", Math.min(i + 1, 4) * 40 + "ms");
  });
  if (!("IntersectionObserver" in window)) {
    els.forEach((e) => e.classList.add("vis"));
  } else {
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((x) => {
          if (x.isIntersecting) {
            x.target.classList.add("vis");
            io.unobserve(x.target);
          }
        }),
      { threshold: 0.05, rootMargin: "0px 0px -2% 0px" },
    );
    els.forEach((e) => io.observe(e));
  }

  if (
    matchMedia("(hover:hover)").matches &&
    !matchMedia("(prefers-reduced-motion:reduce)").matches
  ) {
    document.querySelectorAll(".tc").forEach((c) => {
      let ticking = false,
        px = 0,
        py = 0;
      c.onpointerenter = () => c.classList.add("tilting");
      c.onpointermove = (e) => {
        px = e.clientX;
        py = e.clientY;
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const r = c.getBoundingClientRect();
          const ry = ((px - r.left) / r.width - 0.5) * 10;
          const rx = -((py - r.top) / r.height - 0.5) * 8;
          c.style.setProperty("--ry", ry.toFixed(2) + "deg");
          c.style.setProperty("--rx", rx.toFixed(2) + "deg");
          ticking = false;
        });
      };
      c.onpointerleave = () => {
        c.classList.remove("tilting");
        c.style.setProperty("--rx", "0deg");
        c.style.setProperty("--ry", "0deg");
      };
    });
  }
}
// ===== ROUTER =====
let route = "home",
  arg = null,
  navTok = 0;
function nav() {
  const m = me();
  $("#nv").innerHTML =
    `<a class="l" href="#home">Home</a><a class="l" href="#tutors">Tutors</a><a class="l" href="#faq" data-scroll="faq">FAQ</a>${m ? `<a class="l" href="#${m.role === "admin" ? "admin" : "account"}">Dashboard</a><a class="l" href="#home" id="lo">Log out</a>` : `<a class="l" href="#login">Log in</a>`}<a class="btn sm" href="#book" data-track="book">Book a Session</a>`;
  $("#lo")?.addEventListener("click", async (e) => {
    e.preventDefault();
    resetSession(); // clear first so the auth listener ignores our own sign-out
    try {
      await sb.auth.signOut();
    } catch (_) {}
    nav();
    if (location.hash !== "#home") location.hash = "home";
    else go();
  });
}
function gate(n) {
  sessionStorage.cvnext = n;
  location.hash = "login";
}
function after() {
  const n = sessionStorage.cvnext;
  sessionStorage.removeItem("cvnext");
  const m = me();
  location.hash = n || (m.role === "admin" ? "admin" : "account");
}
// Refresh data from the database when it's stale, so people always see current availability.
async function ensure(r) {
  const now = Date.now(),
    jobs = [],
    maxAge =
      { book: 3000, profile: 5000, account: 3000, admin: 3000 }[r] ?? 30000;
  if (now - FRESH.pub > maxAge) jobs.push(loadPublic());
  if (
    DB.me &&
    ["account", "admin", "book", "paid"].includes(r) &&
    now - FRESH.mine > 3000
  )
    jobs.push(loadMine());
  if (DB.me?.role === "admin" && r === "admin" && now - FRESH.adm > 3000)
    jobs.push(loadAdmin());
  if (jobs.length) await Promise.all(jobs);
}
async function go() {
  const tok = ++navTok;
  const h = location.hash.slice(1) || "home";
  let r = h;
  arg = null;
  if (h.startsWith("tutor-")) {
    r = "profile";
    arg = h.slice(6);
  }
  const R = {
    home,
    tutors,
    profile,
    book,
    signup,
    login,
    account,
    admin,
    paid,
  };
  if (!R[r]) r = "home";
  await ensure(r);
  if (tok !== navTok) return; // the person already navigated somewhere else
  const m = me();
  if ((r === "account" || r === "paid") && !m) return gate("account");
  if (r === "admin" && m?.role !== "admin") return gate("admin");
  if ((r === "login" || r === "signup") && m) {
    return after();
  }
  route = r;
  nav();
  {
    const fe = $("#fe");
    if (fe) {
      fe.textContent = C.email;
      fe.href = "mailto:" + C.email;
    }
  }
  R[r]();
  {
    const a = $("#app");
    a.classList.remove("in");
    void a.offsetWidth;
    a.classList.add("in");
  }
  window.scrollTo(0, 0);
  document.title =
    ({
      book: "Book a Session",
      tutors: "Our tutors",
      login: "Log in",
      signup: "Create account",
      account: "Dashboard",
      admin: "Admin",
      profile: "Tutor profile",
    }[r] || "Cultivar+ | Learn from someone who’s been where you are.") +
    (r === "home" ? "" : " | Cultivar+");
}
addEventListener("hashchange", go);
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-track]");
  if (a) track(a.dataset.track + "_click");
  const s = e.target.closest("[data-scroll]");
  if (s) {
    e.preventDefault();
    if (route !== "home") {
      location.hash = "home";
      setTimeout(() => $("#" + s.dataset.scroll)?.scrollIntoView(), 60);
    } else $("#" + s.dataset.scroll)?.scrollIntoView();
  }
});
// ===== HOME =====
function home() {
  track("page_home");
  const T = allTutors();
  $("#app").innerHTML = `
<section class="hero"><div class="wrap"><div class="hcopy"><h1 class="long">${C.tagline
    .split(" ")
    .map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`)
    .join(
      " ",
    )}</h1><p class="sub">${C.sub}</p><div class="row"><a class="btn" href="#tutors">Meet our tutors</a><a class="btn alt" href="#book" data-track="book">Book a Session</a></div><ul class="facts">${C.facts.map((f) => `<li>${f}</li>`).join("")}</ul><p class="intro">${C.intro}</p></div><div class="uwrap"><aside class="unis" aria-labelledby="uh"><div class="uhd"><h2 id="uh">Where our tutors study</h2><p>Across Ontario, from London to Ottawa.</p></div>${uniMap()}<ul class="ulist">${C.unis.map(([n, c]) => `<li data-c="${c}" title="${c}"><i aria-hidden="true"></i><span>${n}</span></li>`).join("")}</ul></aside></div></div></section>
<section id="tutors-sec"><div class="wrap"><h2 class="center">Choose a mentor, not just a tutor</h2><p class="mut center">Pick by subject, university, program or personality. Every tutor is a real university student.</p><div class="tg" style="margin-top:36px">${T.length ? T.slice(0, 6).map(tcard).join("") : '<p class="mut center">New tutors are joining soon.</p>'}</div><p class="center" style="margin-top:32px"><a class="btn alt" href="#tutors">Browse all tutors</a></p></div></section>
<section class="about"><div class="wrap"><h2>How it works</h2><div class="steps four"><div><h3>Browse tutors</h3><p class="mut">Filter by subject, university and interests.</p></div><div><h3>Read a profile</h3><p class="mut">Meet the person behind the subject.</p></div><div><h3>Book a time</h3><p class="mut">See live availability and pick a slot.</p></div><div><h3>Pay and learn</h3><p class="mut">Pay by card after booking, then meet online.</p></div></div></div></section>
<section><div class="wrap"><h2 class="center">What we help with</h2><p class="mut center">Senior-level courses, plus the things school doesn’t always teach.</p><div class="help">${C.help.map(([h, items]) => `<div><h3>${h}</h3><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`).join("")}</div></div></section>
<section class="voices"><div class="wrap"><h2>What students say</h2><div class="qg">${C.quotes
    .map((q, i) => {
      const [who, ...rest] = q[1].split(", ");
      return `<figure class="q${i ? "" : " lead"}"><blockquote><span class="qo" aria-hidden="true">“</span>${q[0]}<span class="qc" aria-hidden="true">”</span></blockquote><figcaption><b>${who}</b>${rest.length ? `<span>${rest.join(", ")}</span>` : ""}</figcaption></figure>`;
    })
    .join("")}</div></div></section>
<section id="about" class="about"><div class="wrap split"><div><h2>Who we are</h2><div class="tags" style="margin-top:18px">${C.words.map((w) => `<span class="tag">${w}</span>`).join("")}</div></div><div>${C.overview.map((p) => `<p>${p}</p>`).join("")}<h3 style="margin-top:28px">Our mission</h3>${C.mission.map((p) => `<p>${p}</p>`).join("")}</div></div></section>
<section id="faq"><div class="wrap split"><h2>Questions, answered</h2><div>${C.faq.map((f) => `<details><summary>${f[0]}</summary><p>${f[1]}</p></details>`).join("")}</div></div></section>
<section class="cta" id="contact"><div class="wrap"><div><h2>Ready to grow?</h2><p>Find the tutor who feels right and book in minutes.</p><div class="row"><a class="btn white" href="#tutors">Find a tutor</a></div><p style="margin-top:24px">${C.email}<br>${C.phone}</p></div>
<form id="cf" novalidate><label for="cn">Name</label><input id="cn"><label for="ce">Email</label><input id="ce" type="email"><label for="cm">Message</label><textarea id="cm" rows="4"></textarea><p class="err" id="cerr" role="alert"></p><button class="btn">Send message</button></form></div></section>`;
  fx();
  uniHover();
  frameGrown = false;
  blossomFrame();
  $("#cf").onsubmit = async (e) => {
    e.preventDefault();
    if (
      !(
        $("#cn").value.trim() &&
        EMAIL_RE.test($("#ce").value) &&
        $("#cm").value.trim()
      )
    ) {
      $("#cerr").textContent =
        "Please add your name, a valid email, and a message.";
      return;
    }
    const btn = $("#cf button");
    btn.disabled = true;
    $("#cerr").textContent = "";
    const { error } = await sb.rpc("submit_contact", {
      p_name: $("#cn").value,
      p_email: $("#ce").value,
      p_message: $("#cm").value,
    });
    if (error) {
      btn.disabled = false;
      $("#cerr").textContent =
        error.message || "Could not send your message. Please try again.";
      return;
    }
    $("#cf").innerHTML =
      "<h3>Thank you!</h3><p>We got your message and will get back to you soon.</p>";
  };
}
// ===== TUTORS + PROFILE =====
function tutors() {
  const all = allTutors(),
    unis = [...new Set(all.map((t) => t.uni))].sort();
  $("#app").innerHTML =
    `<section class="pg"><div class="wrap"><h1 class="h">Find your tutor</h1><p class="mut">Choose someone you'd be comfortable learning from.</p><div class="row filters"><input id="q" placeholder="Search name, program, interest" aria-label="Search"><select id="fs" aria-label="Subject"><option value="">All subjects</option>${C.subjects.map((s) => `<option>${s}</option>`).join("")}</select><select id="fu" aria-label="University"><option value="">All universities</option>${unis.map((s) => `<option>${esc(s)}</option>`).join("")}</select></div><div class="tg" id="tl"></div></div></section>`;
  const draw = () => {
    const q = $("#q").value.toLowerCase(),
      s = $("#fs").value,
      u = $("#fu").value,
      r = all.filter(
        (t) =>
          (!s || t.subjects.includes(s)) &&
          (!u || t.uni === u) &&
          (!q ||
            [t.name, t.uni, t.program, t.bio, ...t.vibe, ...t.subjects]
              .join(" ")
              .toLowerCase()
              .includes(q)),
      );
    $("#tl").innerHTML = r.length
      ? r.map(tcard).join("")
      : "<p>No tutors match yet. Try clearing a filter.</p>";
    fx();
  };
  ["q", "fs", "fu"].forEach((i) => ($("#" + i).oninput = draw));
  draw();
}
function profile() {
  const t = tut(arg);
  if (!t) {
    $("#app").innerHTML =
      '<section class="pg"><div class="wrap"><h1 class="h">Tutor not found</h1><a class="btn" href="#tutors">Browse tutors</a></div></section>';
    return;
  }
  const sl = slotsFor(t).slice(0, 6),
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || S().tz;
  $("#app").innerHTML =
    `<section class="pg"><div class="wrap prof"><aside class="card pcard">${av(t, "av big")}<h1 class="h" style="font-size:2rem">${esc(t.name)}</h1><p class="uni">${esc(t.uni)}<br>${esc(t.program)}</p><p><b>${money(rateOf(t))}</b> <span class="mut">per hour</span></p><a class="btn" style="width:100%" href="#book" data-track="book" onclick="pick('${t.id}')">Book a Session</a></aside><div><h2>About ${esc(t.name.split(" ")[0])}</h2><p class="lead">${esc(t.bio)}</p><h3>Subjects</h3>${tags(t.subjects)}<h3 style="margin-top:24px">A bit about them</h3>${tags(t.vibe)}<h3 style="margin-top:24px">Ask me about</h3>${tags(t.ask && t.ask.length ? t.ask : ["University applications", "Choosing a program", "Study habits", "Student life"])}<h3 style="margin-top:24px">Next available (${esc(tz)})</h3>${sl.length ? `<div class="tags">${sl.map((ms) => `<span class="tag">${fmt(ms, tz, { weekday: "short", month: "short", day: "numeric" })}, ${tm(ms, tz)}</span>`).join("")}</div>` : '<p class="mut">No open times right now.</p>'}</div></div></section>`;
}
// ===== AUTH =====
function login() {
  $("#app").innerHTML =
    `<div class="lg"><div class="pane">${bloomSvg().replace('class="bloom"', "")}<h1>Welcome back.</h1><p>Log in to book sessions, or manage your tutoring.</p></div><div class="form"><form id="lf" novalidate><h2>Log in</h2><label for="le_">Email</label><input id="le_" type="email" autocomplete="username"><label for="pw">Password</label><div class="pw"><input id="pw" type="password" autocomplete="current-password"><button type="button" id="tp" aria-label="Show password">Show</button></div><p class="err" id="le" role="alert"></p><button class="btn" id="sb" style="margin-top:16px;width:100%">Log in</button><p style="margin:18px 0 0">New here? <a href="#signup">Create an account</a></p></form></div></div>`;
  $("#tp").onclick = () => {
    const p = $("#pw"),
      s = p.type === "password";
    p.type = s ? "text" : "password";
    $("#tp").textContent = s ? "Hide" : "Show";
  };
  $("#lf").onsubmit = async (e) => {
    e.preventDefault();
    const er = $("#le"),
      em = $("#le_").value.trim().toLowerCase(),
      pw = $("#pw").value;
    if (!em || !pw) {
      er.textContent = "Enter your email and password.";
      return;
    }
    let f = LS.get("cv_fail", { n: 0, until: 0 });
    if (Date.now() < f.until) {
      er.textContent = "Too many attempts. Try again in a minute.";
      return;
    }
    const btn = $("#sb");
    btn.disabled = true;
    er.textContent = "";
    AUTH.busy++;
    try {
      const { error } = await sb.auth.signInWithPassword({
        email: em,
        password: pw,
      });
      if (error) {
        console.warn("Login error:", error.message);
        if (/invalid login/i.test(error.message)) {
          f.n++;
          if (f.n >= 5) f = { n: 0, until: Date.now() + 6e4 };
          LS.set("cv_fail", f);
        }
        er.textContent = authMsg(error);
        return;
      }
      LS.set("cv_fail", { n: 0, until: 0 });
      await loadSession();
      if (!DB.me) {
        er.textContent =
          DB.issue === "suspended"
            ? "This account is suspended. Please contact Cultivar+."
            : DB.issue === "noprofile"
              ? "Your login worked, but this account has no profile row. Please contact Cultivar+."
              : "We couldn't load your account" +
                (DB.detail ? " (" + DB.detail + ")" : "") +
                ". Please try again.";
        return;
      }
      await Promise.all([loadPublic(), loadMine()]);
      if (DB.me.role === "admin") await loadAdmin();
      after();
    } finally {
      AUTH.busy--;
      btn.disabled = false;
    }
  };
}
const tutorFields = (t) =>
  `<label for="un">University</label><input id="un" value="${esc(t.uni)}" placeholder="e.g. University of Toronto"><label for="pr">Program and year</label><input id="pr" value="${esc(t.program)}" placeholder="e.g. Life Sciences, Year 2"><fieldset class="fs"><legend>Subjects you tutor</legend>${C.subjects.map((s) => `<label class="chk"><input type="checkbox" name="sj" value="${s}" ${t.subjects?.includes(s) ? "checked" : ""}><span>${s}</span></label>`).join("")}</fieldset><label for="vb">Personality and interests (comma separated)</label><input id="vb" value="${esc((t.vibe || []).join(", "))}" placeholder="Patient, chess club, loves coffee"><label for="bi">Short bio</label><textarea id="bi" rows="4" maxlength="400">${esc(t.bio)}</textarea><label for="ph">Profile photo</label><input id="ph" type="file" accept="image/*"><label for="pl">Your Stripe Payment Link (optional)</label><input id="pl" value="${esc(t.payLink || "")}" placeholder="https://buy.stripe.com/...">`;

function readTutor(existingPhoto = "") {
  const sj = [...document.querySelectorAll("[name=sj]:checked")].map(
    (x) => x.value,
  );
  return {
    uni: $("#un").value.trim(),
    program: $("#pr").value.trim(),
    subjects: sj,
    vibe: $("#vb")
      .value.split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    bio: $("#bi").value.trim(),
    payLink: $("#pl").value.trim(),
    photo: existingPhoto || "",
  };
}

function signup() {
  let role = sessionStorage.cvrole === "tutor" ? "tutor" : "student";
  sessionStorage.removeItem("cvrole");
  $("#app").innerHTML =
    `<section class="pg"><div class="wrap" style="max-width:640px"><h1 class="h">Create your account</h1><div class="gb" role="group" aria-label="Account type" style="margin:14px 0"><button class="chip" id="rs" type="button">I'm a student</button><button class="chip" id="rt_" type="button">I'm a tutor</button></div><form id="sf" novalidate><div class="two"><div><label for="nm">Full name</label><input id="nm" autocomplete="name"></div><div><label for="em">Email</label><input id="em" type="email" autocomplete="email"></div></div><label for="pw">Password (8+ characters)</label><input id="pw" type="password" autocomplete="new-password"><div id="stu"><label for="gr">Grade</label><select id="gr">${[9, 10, 11, 12].map((g) => `<option>${g}</option>`).join("")}</select></div><div id="tu" hidden>${tutorFields({ subjects: [], vibe: [], bio: "", rate: 40 })}</div><label class="chk" style="margin-top:16px"><input type="checkbox" id="ck"><span>I agree to the Terms and Privacy Policy. If I'm under 18, a parent or guardian knows I'm signing up.</span></label><p class="err" id="er" role="alert"></p><button class="btn" style="width:100%;margin-top:14px">Create account</button><p style="margin-top:16px">Already have an account? <a href="#login">Log in</a></p></form></div></section>`;
  const set = (r) => {
    role = r;
    $("#rs").setAttribute("aria-pressed", r === "student");
    $("#rt_").setAttribute("aria-pressed", r === "tutor");
    $("#stu").hidden = r !== "student";
    $("#tu").hidden = r !== "tutor";
  };
  set(role);
  $("#rs").onclick = () => set("student");
  $("#rt_").onclick = () => set("tutor");
  let selectedFile = null;
  $("#ph") &&
    ($("#ph").onchange = (e) => {
      selectedFile = e.target.files[0] || null;
    });
  $("#sf").onsubmit = async (e) => {
    e.preventDefault();
    const er = $("#er"),
      nm = $("#nm").value.trim(),
      em = $("#em").value.trim().toLowerCase(),
      pw = $("#pw").value;
    er.style.color = "";
    if (!nm || !EMAIL_RE.test(em)) {
      er.textContent = "Please add your name and a valid email.";
      return;
    }
    if (pw.length < 8) {
      er.textContent = "Password must be at least 8 characters.";
      return;
    }
    if (!$("#ck").checked) {
      er.textContent = "Please accept the terms to continue.";
      return;
    }
    const meta = { role, name: nm };
    if (role === "student") meta.grade = +$("#gr").value;
    else {
      const t = readTutor("");
      if (!t.uni || !t.program || !t.subjects.length || t.bio.length < 20) {
        er.textContent =
          "Tutors need a university, program, at least one subject and a short bio (20+ characters).";
        return;
      }
      if (t.payLink && !PAY_LINK_RE.test(t.payLink)) {
        er.textContent =
          "Your payment link must be a Stripe link starting with https://buy.stripe.com/";
        return;
      }
      Object.assign(meta, {
        uni: t.uni,
        program: t.program,
        subjects: t.subjects,
        vibe: t.vibe,
        bio: t.bio,
        pay_link: t.payLink,
      });
    }
    const lock = (v) =>
      $("#sf")
        ?.querySelectorAll("button")
        .forEach((b) => (b.disabled = v));
    lock(true);
    er.style.color = "var(--ink)";
    er.textContent = "Creating your account…";
    AUTH.busy++;
    try {
      const { data, error } = await sb.auth.signUp({
        email: em,
        password: pw,
        options: {
          data: meta,
          emailRedirectTo: location.origin + location.pathname,
        },
      });
      er.style.color = "";
      if (error) {
        er.textContent = authMsg(error);
        return;
      }
      // Supabase hides "already registered" by returning a user with no identities.
      if (data.user?.identities && data.user.identities.length === 0) {
        er.textContent = "That email already has an account. Try logging in.";
        return;
      }
      track("signup_" + role);
      if (!data.session) {
        // Email confirmation is switched on in Supabase: they must click the link first.
        $("#sf").innerHTML =
          `<h2>Check your email</h2><p>We sent a confirmation link to <b>${esc(em)}</b>. Click it, then <a href="#login">log in</a>.</p>${role === "tutor" ? '<p class="mut">After you log in, add your profile photo from your dashboard (Profile tab).</p>' : ""}`;
        return;
      }
      await loadSession();
      if (role === "tutor" && selectedFile && DB.me) {
        er.style.color = "var(--ink)";
        er.textContent = "Uploading photo…";
        const url = await uploadTutorPhoto(selectedFile, DB.me.id);
        if (url) await saveMine({ photo: url });
      }
      await Promise.all([loadPublic(), loadMine()]);
      after();
    } finally {
      AUTH.busy--;
      lock(false);
    }
  };
}
// ===== BOOKING =====
let st = {
  step: 1,
  tutor: null,
  subject: null,
  grade: null,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto",
  month: null,
  day: null,
  slot: null,
  notes: "",
  fm: "Online",
  ref: null,
};
function side() {
  const t = st.tutor && tut(st.tutor);
  return `<aside class="side"><img src="assets/logo.png" alt="Cultivar+"><h3>Tutoring session</h3>${t ? `<div class="mini">${av(t, "av sm")}<div><b>${esc(t.name)}</b><br><small>${esc(t.uni)}</small></div></div>` : ""}<dl><dt>Duration</dt><dd>${S().len} minutes</dd>${t ? `<dt>Price</dt><dd>${money(price(t))}</dd>` : ""}${st.subject ? `<dt>Subject</dt><dd>${esc(st.subject)}${st.grade ? ", " + gl(st.grade) : ""}</dd>` : ""}${st.slot ? `<dt>When</dt><dd>${fmt(st.slot, st.tz, { weekday: "long", month: "long", day: "numeric" })}<br>${tm(st.slot, st.tz)}</dd>` : ""}<dt>Time zone</dt><dd>${esc(st.tz)}</dd></dl></aside>`;
}
const prog = () =>
  `<div class="prog" aria-label="Progress">${["Tutor", "Time", "Details", "Payment", "Done"].map((n, i) => `<span class="${i + 1 === st.step ? "on" : i + 1 < st.step ? "done" : ""}" ${i + 1 === st.step ? 'aria-current="step"' : ""}>${n}</span>`).join("")}</div>`;
function book() {
  track("book_view");
  const m = me();
  if (st.step === 5 && route === "book" && !st._keep)
    Object.assign(st, {
      step: 1,
      subject: null,
      slot: null,
      day: null,
      month: null,
      ref: null,
      notes: "",
    });
  st._keep = 0;
  if (m && m.role !== "student") {
    $("#app").innerHTML =
      '<section class="pg"><div class="wrap"><h1 class="h">Booking is for students</h1><p>You are signed in as ' +
      (m.role === "admin" ? "an admin" : "a tutor") +
      '. Log out and use a student account to book sessions.</p><a class="btn" href="#' +
      (m.role === "admin" ? "admin" : "account") +
      '">Go to your dashboard</a></div></section>';
    return;
  }
  $("#app").innerHTML =
    `<section class="book"><div class="wrap"><h1>Book a session</h1><div class="bk">${side()}<div class="main">${prog()}<div id="bs"></div></div></div></div></section>`;
  step();
}
function step() {
  clearInterval(st.h);
  $(".side").outerHTML = side();
  $(".prog").outerHTML = prog();
  const b = $("#bs");
  b.classList.remove("enter");
  void b.offsetWidth;
  b.classList.add("enter");
  [0, s1, s2, s3, s4, s5][st.step]();
  window.scrollTo({ top: 0 });
}
function s1() {
  const T = allTutors(),
    t = st.tutor && tut(st.tutor);
  $("#bs").innerHTML =
    `<h2>Choose your tutor</h2><div class="pick">${T.map((x) => `<button class="pk ${x.id === st.tutor ? "sel" : ""}" data-t="${x.id}" aria-pressed="${x.id === st.tutor}">${av(x, "av sm")}<span><b>${esc(x.name)}</b><br><small>${esc(x.uni)} · ${esc(x.program)}</small><br><small>${esc(x.subjects.join(", "))} · ${money(rateOf(x))}/hr</small></span></button>`).join("")}</div>${t ? `<div class="two"><div><label for="sj">Subject</label><select id="sj"><option value="">Select…</option>${t.subjects.map((s) => `<option ${s === st.subject ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div><div><label for="gd">Your grade</label><select id="gd"><option value="">Select…</option>${[9, 10, 11, 12].map((g) => `<option value="${g}" ${g === st.grade ? "selected" : ""}>${gl(g)}</option>`).join("")}</select></div></div>` : ""}<div class="nav2"><span></span><button class="btn" id="nx" ${t && st.subject && st.grade ? "" : "disabled"}>Next</button></div>`;
  document.querySelectorAll("[data-t]").forEach(
    (b) =>
      (b.onclick = () => {
        if (st.tutor !== b.dataset.t) {
          st.tutor = b.dataset.t;
          st.subject = null;
          st.slot = st.day = st.month = null;
        }
        step();
      }),
  );
  $("#sj") &&
    ($("#sj").onchange = (e) => {
      st.subject = e.target.value;
      s1();
      $(".side").outerHTML = side();
    });
  $("#gd") &&
    ($("#gd").onchange = (e) => {
      st.grade = +e.target.value || null;
      s1();
    });
  $("#nx").onclick = () => {
    st.step = 2;
    step();
  };
}
function s2() {
  const t = tut(st.tutor),
    a = slotsFor(t),
    by = {};
  a.forEach((ms) => (by[dkey(ms, st.tz)] ??= []).push(ms));
  const keys = Object.keys(by).sort(),
    anim = st._a;
  st._a = 0;
  if (!keys.length) {
    $("#bs").innerHTML =
      `<h2>No open times</h2><p>${esc(t.name)} has no open times right now. Try another tutor.</p><div class="nav2"><button class="btn alt" id="bk">Back</button><span></span></div>`;
    $("#bk").onclick = () => {
      st.step = 1;
      step();
    };
    return;
  }
  if (!st.month) st.month = keys[0].slice(0, 7);
  const [Y, M] = st.month.split("-").map(Number),
    first = new Date(Date.UTC(Y, M - 1, 1)).getUTCDay(),
    dim = new Date(Date.UTC(Y, M, 0)).getUTCDate(),
    today = dkey(Date.now(), st.tz),
    mk = keys.map((k) => k.slice(0, 7));
  let c = "<span></span>".repeat(first);
  for (let d = 1; d <= dim; d++) {
    const k = `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      v = !!by[k];
    c += `<button class="d ${v ? "ya" : ""} ${k === st.day ? "sel" : ""} ${k === today ? "today" : ""}" data-d="${k}" ${v ? "" : "disabled"} aria-label="${k}${v ? ", available" : ", unavailable"}">${d}</button>`;
  }
  const zs = Intl.supportedValuesOf
    ? Intl.supportedValuesOf("timeZone")
    : [st.tz];
  if (!zs.includes(st.tz)) zs.unshift(st.tz);
  $("#bs").innerHTML =
    `<h2>Pick a date and time</h2><div class="cal ${st.day ? "" : "one"}"><div><div class="mh"><button id="pm" aria-label="Previous month" ${st.month > mk[0] ? "" : "disabled"}>‹</button><b>${new Date(Date.UTC(Y, M - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}</b><button id="nm2" aria-label="Next month" ${st.month < mk[mk.length - 1] ? "" : "disabled"}>›</button></div><div class="dg">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<b aria-hidden="true">${x}</b>`).join("")}${c}</div><div class="tz"><label for="tzs" style="display:inline;margin-right:6px">Time zone</label><select id="tzs">${zs.map((z) => `<option ${z === st.tz ? "selected" : ""}>${z}</option>`).join("")}</select></div></div>${st.day ? `<div><h3>${new Date(st.day + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" })}</h3><div class="slots ${anim ? "stag" : ""}" role="group" aria-label="Times">${by[st.day].map((ms, i) => `<button class="chip ${ms === st.slot ? "sel" : ""}" style="--i:${i}" data-s="${ms}" aria-pressed="${ms === st.slot}">${tm(ms, st.tz)}</button>`).join("")}</div></div>` : ""}</div><div class="nav2"><button class="btn alt" id="bk">Back</button><button class="btn" id="nx" ${st.slot ? "" : "disabled"}>Next</button></div>`;
  $("#pm").onclick = () => {
    st.month = new Date(Date.UTC(Y, M - 2, 1)).toISOString().slice(0, 7);
    s2();
  };
  $("#nm2").onclick = () => {
    st.month = new Date(Date.UTC(Y, M, 1)).toISOString().slice(0, 7);
    s2();
  };
  document.querySelectorAll("[data-d]").forEach(
    (b) =>
      (b.onclick = () => {
        st.day = b.dataset.d;
        st.slot = null;
        st._a = 1;
        s2();
      }),
  );
  document.querySelectorAll("[data-s]").forEach(
    (b) =>
      (b.onclick = () => {
        st.slot = +b.dataset.s;
        s2();
        $(".side").outerHTML = side();
      }),
  );
  $("#tzs").onchange = (e) => {
    st.tz = e.target.value;
    st.day = st.slot = st.month = null;
    step();
  };
  $("#bk").onclick = () => {
    st.step = 1;
    step();
  };
  $("#nx").onclick = () => {
    st.step = 3;
    step();
  };
}
function s3() {
  const m = me(),
    t = tut(st.tutor);
  if (!m) {
    $("#bs").innerHTML =
      `<h2>Log in to continue</h2><p>Create a free student account or log in to confirm this booking. Your tutor and time are saved.</p><div class="row"><a class="btn" href="#signup" onclick="sessionStorage.cvnext='book'">Create account</a><a class="btn alt" href="#login" onclick="sessionStorage.cvnext='book'">Log in</a></div><div class="nav2"><button class="btn alt" id="bk">Back</button><span></span></div>`;
    $("#bk").onclick = () => {
      st.step = 2;
      step();
    };
    return;
  }
  $("#bs").innerHTML =
    `<h2>Confirm your booking</h2><div class="card"><b>${esc(t.name)}</b> · ${esc(st.subject)}, ${gl(st.grade)}<br>${fmt(st.slot, st.tz, { weekday: "long", month: "long", day: "numeric" })}, ${tm(st.slot, st.tz)}<br>${money(price(t))} · you pay after booking</div><p class="mut" style="margin-top:12px">Booking as <b>${esc(m.name)}</b> (${esc(m.email)})</p><label for="fm">Session format</label><select id="fm"><option ${st.fm === "In person" ? "" : "selected"}>Online</option><option ${st.fm === "In person" ? "selected" : ""}>In person</option></select><label for="nt">What would you like help with? (optional)</label><textarea id="nt" rows="3">${esc(st.notes)}</textarea><p class="err" id="e" role="alert"></p><div class="nav2"><button class="btn alt" id="bk">Back</button><button class="btn" id="cf">Confirm booking</button></div>`;
  $("#bk").onclick = () => {
    st.notes = $("#nt").value;
    st.fm = $("#fm").value;
    st.step = 2;
    step();
  };
  $("#cf").onclick = async () => {
    st.notes = $("#nt").value;
    st.fm = $("#fm").value;
    const btn = $("#cf");
    $("#e").textContent = "";
    if (slotsFor(t).indexOf(st.slot) < 0) {
      alert("Sorry, that time was just taken. Please pick another.");
      st.slot = null;
      st.step = 2;
      step();
      return;
    }
    btn.disabled = true;
    // The database checks availability, double-booking, notice, and sets the price.
    const { data, error } = await sb.rpc("create_booking", {
      p_tutor: t.id,
      p_subject: st.subject,
      p_grade: st.grade,
      p_start: new Date(st.slot).toISOString(),
      p_format: st.fm,
      p_notes: st.notes,
      p_tz: st.tz,
    });
    if (error) {
      btn.disabled = false;
      if (
        /just taken|too soon|available hours|not available then|off that day/i.test(
          error.message,
        )
      ) {
        alert(error.message);
        await loadPublic();
        st.slot = null;
        st.step = 2;
        step();
        return;
      }
      $("#e").textContent = error.message || "Could not create the booking.";
      return;
    }
    await Promise.all([loadMine(), loadPublic()]);
    st.ref = data.id;
    track("booking_done");
    st.step = 4;
    step();
  };
}
function payBtns(b) {
  const t = tut(b.tutor),
    link = t?.payLink || CFG.stripeLink;
  if (b.paid === "paid") return '<span class="badge ok">Paid</span>';
  if (b.paid === "review")
    return '<span class="badge">Payment awaiting confirmation</span>';
  if (CFG.checkoutUrl)
    return `<button class="btn" data-stripe="${b.id}">Pay ${money(b.amount)} with card</button>`;
  return link
    ? `<a class="btn" href="${esc(link)}${link.includes("?") ? "&" : "?"}client_reference_id=${b.id}&prefilled_email=${encodeURIComponent(b.email)}" data-pay="${b.id}">Pay ${money(b.amount)} with card</a>`
    : `<button class="btn" data-demo="${b.id}">Pay ${money(b.amount)} (demo)</button>`;
}
function bindPay(root, cb) {
  root.querySelectorAll("[data-stripe]").forEach(
    (a) =>
      (a.onclick = async () => {
        const old = a.textContent;
        a.disabled = true;
        a.textContent = "Opening Stripe…";
        try {
          // Only the booking reference is sent; the server looks up the real amount.
          const { data: d, error } = await sb.functions.invoke(
            "create-checkout",
            {
              body: {
                action: "create",
                ref: a.dataset.stripe,
                path: location.pathname,
              },
            },
          );
          if (error) throw new Error(await fnErr(error));
          if (!d?.url || !/^https:\/\/checkout\.stripe\.com\//.test(d.url))
            throw new Error(d?.error || "No checkout link returned");
          LS.set("cv_paying", a.dataset.stripe);
          location.href = d.url;
        } catch (e) {
          alert("Could not start payment: " + e.message);
          a.disabled = false;
          a.textContent = old;
        }
      }),
  );
  root
    .querySelectorAll("[data-pay]")
    .forEach((a) =>
      a.addEventListener("click", () => LS.set("cv_paying", a.dataset.pay)),
    );
  root
    .querySelectorAll("[data-demo]")
    .forEach((a) => (a.onclick = () => setPaid(a.dataset.demo, "review", cb)));
}
// Admins can set any status; students can only flag their own booking "awaiting confirmation".
// A booking only becomes "paid" through the Stripe webhook/verification or an admin.
async function setPaid(id, v, cb) {
  const { error } = await sb.rpc("set_payment_status", {
    p_id: id,
    p_status: v,
  });
  if (error) {
    alert("Could not update payment: " + error.message);
    return;
  }
  await loadMine();
  cb();
}
function s4() {
  const b = B().find((x) => x.id === st.ref);
  $("#bs").innerHTML =
    `<div class="done-wrap"><div class="okc" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><div class="burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div><h2>You're booked. Now pay to lock it in.</h2><p>Reference <b>${b.id}</b>. Pay securely by credit card. ${CFG.checkoutUrl || CFG.stripeLink ? "" : '<span class="badge">Demo mode: no real payment is taken</span>'}</p><div class="row" id="pb">${payBtns(b)}<button class="btn alt" id="lt">Pay later</button></div><div id="pc"></div>`;
  const re = () => {
    if (
      B().find((x) => x.id === b.id).paid === "paid" ||
      B().find((x) => x.id === b.id).paid === "review"
    ) {
      st.step = 5;
      st._keep = 1;
      step();
    } else s4();
  };
  bindPay($("#pb"), re);
  $("#lt").onclick = () => {
    st.step = 5;
    step();
  };
}
function s5() {
  const b = B().find((x) => x.id === st.ref),
    s = S(),
    t = tut(b.tutor),
    z = (m) => new Date(m).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const gc = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("Cultivar+ with " + b.tutorName)}&dates=${z(b.start)}/${z(b.end)}&details=${encodeURIComponent(s.link)}`;
  $("#bs").innerHTML =
    `<h2>All set!</h2><div class="card"><b>Reference:</b> ${b.id}<br><b>Tutor:</b> ${esc(b.tutorName)}<br><b>When:</b> ${fmt(b.start, st.tz, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${tm(b.start, st.tz)} (${esc(st.tz)})<br><b>Subject:</b> ${esc(b.subject)}, ${gl(b.grade)}<br><b>${b.format === "Online" ? "Meeting link:" : "Location:"}</b> ${b.format === "Online" ? `<a href="${esc(s.link)}">${esc(s.link)}</a>` : "To be confirmed with your tutor"}<br><b>Payment:</b> ${b.paid === "paid" ? "Paid" : b.paid === "review" ? "Awaiting confirmation" : "Unpaid"}</div><div class="row" style="margin-top:20px" id="pb">${b.paid === "unpaid" ? payBtns(b) : ""}<a class="btn alt" href="${gc}" target="_blank" rel="noopener">Add to Google Calendar</a><button class="btn alt" id="ics">Download .ics</button><a class="btn alt" href="#account">My dashboard</a></div>`;
  bindPay($("#pb"), () => {
    st._keep = 1;
    s5();
  });
  $("#ics").onclick = () => {
    const u = URL.createObjectURL(
      new Blob(
        [
          `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Cultivar+//EN\r\nBEGIN:VEVENT\r\nUID:${b.id}@cultivar\r\nDTSTAMP:${z(Date.now())}\r\nDTSTART:${z(b.start)}\r\nDTEND:${z(b.end)}\r\nSUMMARY:Cultivar+ with ${b.tutorName}\r\nDESCRIPTION:${s.link}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        ],
        { type: "text/calendar" },
      ),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = b.id + ".ics";
    a.click();
  };
}
// ===== RETURN FROM STRIPE =====
async function paid() {
  const cs = new URLSearchParams(location.search).get("cs");
  history.replaceState(null, "", location.pathname + "#paid");
  const id = LS.get("cv_paying", null);
  let msg =
    "We could not find a pending payment. If you were charged, contact Cultivar+.";
  if (cs) {
    try {
      // The server asks Stripe directly and checks the amount against the booking.
      const { data: d, error } = await sb.functions.invoke("create-checkout", {
        body: { action: "verify", session_id: cs },
      });
      if (error) throw new Error(await fnErr(error));
      msg = d?.paid
        ? "Payment confirmed. Thank you!"
        : "We could not confirm your payment yet. If you were charged, contact Cultivar+.";
    } catch (e) {
      msg = "Thanks! Your payment is being confirmed.";
    }
  } else if (id) {
    const { error } = await sb.rpc("set_payment_status", {
      p_id: id,
      p_status: "review",
    });
    if (!error)
      msg = "Thanks! Your payment is being confirmed. Your session is booked.";
  }
  LS.set("cv_paying", null);
  await loadMine();
  sessionStorage.cvmsg = msg;
  location.hash = "account";
}
// ===== DASHBOARDS =====
let tab = "sessions";
const cancel = async (id) => {
  if (!confirm("Cancel this session?")) return;
  const { error } = await sb.rpc("cancel_booking", { p_id: id });
  if (error) {
    alert(error.message);
    return;
  }
  await Promise.all([loadMine(), loadPublic()]);
  go();
};
const when = (b, tz) =>
  fmt(b.start, tz, { dateStyle: "medium", timeStyle: "short" });
function account() {
  const m = me();
  if (m.role === "admin") {
    location.hash = "admin";
    return;
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const all = B()
      .filter((b) =>
        m.role === "student" ? b.student === m.id : b.tutor === m.id,
      )
      .sort((a, b) => a.start - b.start),
    now = Date.now(),
    up = all.filter((b) => b.end > now && b.status === "confirmed"),
    past = all.filter((b) => !(b.end > now && b.status === "confirmed"));
  const row = (b) =>
    `<tr><td>${when(b, tz)}</td><td>${m.role === "student" ? esc(b.tutorName) : `${esc(b.studentName)}<br><small>${gl(b.grade)} · ${esc(b.email)}</small>`}</td><td>${esc(b.subject)}${b.notes ? `<br><small>${esc(b.notes)}</small>` : ""}</td><td>${b.status !== "confirmed" ? b.status : b.paid === "paid" ? '<span class="badge ok">Paid</span>' : b.paid === "review" ? '<span class="badge">Awaiting confirmation</span>' : "Unpaid"}</td><td class="act">${b.status === "confirmed" && b.end > now ? `${m.role === "student" && b.paid === "unpaid" ? payBtns(b).replace('class="btn"', 'class="btn sm"') : ""}${b.start - now > 864e5 ? `<button class="btn alt sm" data-c="${b.id}">Cancel</button>` : ""}` : ""}</td></tr>`;
  const tbl = (r, e) =>
    r.length
      ? `<div class="tbl"><table><tr><th>When (${esc(tz)})</th><th>${m.role === "student" ? "Tutor" : "Student"}</th><th>Subject</th><th>Payment</th><th></th></tr>${r.map(row).join("")}</table></div>`
      : `<p class="mut">${e}</p>`;
  const sess = `<h2>Upcoming sessions</h2>${tbl(up, m.role === "student" ? "No upcoming sessions yet." : "No students have booked yet. Make sure your availability is set.")}<h2 style="margin-top:36px">Past and cancelled</h2>${tbl(past, "Nothing here yet.")}`;
  let body;
  const banner = sessionStorage.cvmsg
    ? `<p class="note" role="status">${esc(sessionStorage.cvmsg)}</p>`
    : "";
  sessionStorage.removeItem("cvmsg");
  if (m.role === "student") {
    body = `<div class="row between"><h1 class="h" style="margin:0">Hi, ${esc(m.name.split(" ")[0])}</h1><a class="btn" href="#tutors">Book a Session</a></div><p class="mut">${gl(m.grade)} student</p>${sess}`;
  } else {
    const tabs = [
      ["sessions", "Bookings"],
      ["avail", "Availability"],
      ["profile", "Profile"],
      ["earn", "Earnings"],
    ];
    body = `<div class="row between"><h1 class="h" style="margin:0">Hi, ${esc(m.name.split(" ")[0])}</h1><a class="btn alt sm" href="#tutor-${m.id}">View public profile</a></div><div class="tabs">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? "sel" : ""}" data-t="${k}">${l}</button>`).join("")}</div><div id="tb"></div>`;
  }
  $("#app").innerHTML =
    `<section class="adm"><div class="wrap">${banner}${body}</div></section>`;
  const wire = () => {
    document
      .querySelectorAll("[data-c]")
      .forEach((x) => (x.onclick = () => cancel(x.dataset.c)));
    bindPay($("#app"), account);
  };
  if (m.role === "student") {
    wire();
    return;
  }
  document.querySelectorAll("[data-t]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.t;
        account();
      }),
  );
  const el = $("#tb");
  if (tab === "sessions") {
    el.innerHTML = sess;
    wire();
  }
  if (tab === "avail") {
    el.innerHTML = `<p>Set your weekly hours (24h clock, ${esc(S().tz)}). Leave blank on days you're off. Students only see times inside these hours.</p><div class="grid">${DOW.map((n, i) => `<div class="card"><h3>${n}</h3><label>From</label><input type="number" min="0" max="23" data-h="${i}0" value="${m.avail?.[i]?.[0] ?? ""}"><label>To</label><input type="number" min="1" max="24" data-h="${i}1" value="${m.avail?.[i]?.[1] ?? ""}"></div>`).join("")}</div><button class="btn" id="sv" style="margin-top:18px">Save hours</button><h3 style="margin-top:32px">Days off</h3><div class="row"><input type="date" id="bd" style="width:auto"><button class="btn alt sm" id="bl">Block this date</button></div><div class="tags" style="margin-top:12px">${(m.blocked || []).map((d) => `<button class="tag x" data-u="${d}" aria-label="Remove ${d}">${d} ×</button>`).join("") || '<span class="mut">None</span>'}</div>`;
    $("#sv").onclick = async () => {
      const h = {};
      for (let i = 0; i < 7; i++) {
        const a = $(`[data-h="${i}0"]`).value,
          b = $(`[data-h="${i}1"]`).value;
        h[i] = a !== "" && b !== "" && +b > +a ? [+a, +b] : null;
      }
      if (await saveMine({ avail: h })) $("#sv").textContent = "Saved ✓";
    };
    $("#bl").onclick = async () => {
      const d = $("#bd").value;
      if (
        d &&
        (await saveMine({
          blocked: [...new Set([...(me().blocked || []), d])],
        }))
      )
        account();
    };
    document.querySelectorAll("[data-u]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            await saveMine({
              blocked: (me().blocked || []).filter((y) => y !== b.dataset.u),
            })
          )
            account();
        }),
    );
  }
  if (tab === "profile") {
    el.innerHTML = `<form id="pf" style="max-width:620px"><p class="note">Your session rate is set by Cultivar+ (currently ${money(rateOf(m))} per hour).</p><label for="nm">Name</label><input id="nm" value="${esc(m.name)}">${tutorFields(m)}<p class="err" id="er" role="alert"></p><button class="btn" style="margin-top:14px">Save profile</button></form>`;
    let profileFile = null;
    $("#ph").onchange = (e) => {
      profileFile = e.target.files[0] || null;
    };
    $("#pf").onsubmit = async (e) => {
      e.preventDefault();
      const er = $("#er"),
        cur = me();
      er.style.color = "";
      const chk = readTutor(cur.photo || "");
      if (!chk.subjects.length || chk.bio.length < 20) {
        er.style.color = "#b00020";
        er.textContent = "Add at least one subject and a short bio.";
        return;
      }
      if (chk.payLink && !PAY_LINK_RE.test(chk.payLink)) {
        er.style.color = "#b00020";
        er.textContent =
          "Your payment link must be a Stripe link starting with https://buy.stripe.com/";
        return;
      }
      let photoUrl = cur.photo || "";
      if (profileFile) {
        er.style.color = "var(--ink)";
        er.textContent = "Uploading new photo…";
        const uploadedUrl = await uploadTutorPhoto(profileFile, cur.id);
        if (uploadedUrl) photoUrl = uploadedUrl;
      }
      const t = readTutor(photoUrl);
      const ok = await saveMine({
        name: $("#nm").value.trim() || cur.name,
        uni: t.uni,
        program: t.program,
        subjects: t.subjects,
        vibe: t.vibe,
        bio: t.bio,
        pay_link: t.payLink || null,
        photo: t.photo || null,
      });
      if (ok) {
        profileFile = null;
        er.style.color = "#0a7a3d";
        er.textContent = "Saved ✓";
      } else er.textContent = "";
    };
  }
  if (tab === "earn") {
    const paid = all.filter(
        (b) => b.paid === "paid" && b.status === "confirmed",
      ),
      aw = all.filter((b) => b.paid !== "paid" && b.status === "confirmed");
    el.innerHTML = `<div class="grid"><div class="card"><h3>${money(paid.reduce((s, b) => s + b.amount, 0))}</h3><p class="mut">Paid sessions (${paid.length})</p></div><div class="card"><h3>${money(aw.reduce((s, b) => s + b.amount, 0))}</h3><p class="mut">Unpaid or awaiting confirmation (${aw.length})</p></div></div><p class="note" style="margin-top:18px">Payouts: if you add your own Stripe Payment Link in Profile, students pay you directly.</p>`;
  }
}
// ===== ADMIN =====
let atab = "b";
function admin() {
  const bs = B().sort((a, b) => a.start - b.start),
    an = DB.an,
    s = S();
  $("#app").innerHTML =
    `<section class="adm"><div class="wrap"><div class="row between"><h1 class="h" style="margin:0">Admin</h1></div><div class="tabs">${[
      ["b", "Bookings"],
      ["u", "Users"],
      ["m", "Messages"],
      ["s", "Settings"],
    ]
      .map(
        ([k, l]) =>
          `<button class="chip ${atab === k ? "sel" : ""}" data-a="${k}">${l}</button>`,
      )
      .join("")}</div><div id="at"></div></div></section>`;
  document.querySelectorAll("[data-a]").forEach(
    (b) =>
      (b.onclick = () => {
        atab = b.dataset.a;
        admin();
      }),
  );
  const el = $("#at");
  if (atab === "b") {
    const paidT = bs
      .filter((b) => b.paid === "paid" && b.status === "confirmed")
      .reduce((x, b) => x + b.amount, 0);
    el.innerHTML = `<p class="note">Home views ${an.page_home || 0} · Book clicks ${an.book_click || 0} · Bookings ${an.booking_done || 0} · Sign-ups ${(an.signup_student || 0) + (an.signup_tutor || 0)} · Paid total ${money(paidT)}</p><div class="row" style="margin-bottom:14px"><button class="btn alt sm" id="csv">Export CSV</button></div><div class="tbl">${bs.length ? `<table><tr><th>Ref</th><th>When (${esc(s.tz)})</th><th>Tutor</th><th>Student</th><th>Status</th><th>Payment</th><th></th></tr>${bs.map((b) => `<tr><td>${b.id}</td><td>${fmt(b.start, s.tz, { dateStyle: "medium", timeStyle: "short" })}</td><td>${esc(b.tutorName)}</td><td>${esc(b.studentName)}<br><small>${esc(b.email)}</small></td><td>${b.status}</td><td>${b.paid}</td><td class="act">${b.paid !== "paid" && b.status === "confirmed" ? `<button class="btn sm" data-p="${b.id}">Mark paid</button>` : ""}${b.status === "confirmed" ? `<button class="btn alt sm" data-c="${b.id}">Cancel</button>` : ""}</td></tr>`).join("")}</table>` : '<p style="padding:16px">No bookings yet.</p>'}</div>`;
    document
      .querySelectorAll("[data-p]")
      .forEach((x) => (x.onclick = () => setPaid(x.dataset.p, "paid", admin)));
    document
      .querySelectorAll("[data-c]")
      .forEach((x) => (x.onclick = () => cancel(x.dataset.c)));
    $("#csv").onclick = () => {
      const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"',
        r = [
          [
            "ref",
            "start_utc",
            "tutor",
            "student",
            "email",
            "subject",
            "grade",
            "amount",
            "status",
            "payment",
          ],
          ...bs.map((b) => [
            b.id,
            new Date(b.start).toISOString(),
            b.tutorName,
            b.studentName,
            b.email,
            b.subject,
            b.grade,
            b.amount,
            b.status,
            b.paid,
          ]),
        ];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([r.map((x) => x.map(q).join(",")).join("\n")], {
          type: "text/csv",
        }),
      );
      a.download = "cultivar-bookings.csv";
      a.click();
    };
  }

  if (atab === "u") {
    const u = U(),
      bk = B(),
      cnt = (id) =>
        bk.filter(
          (x) =>
            x.status === "confirmed" && (x.student === id || x.tutor === id),
        ).length;
    el.innerHTML = `<div class="row" style="margin-bottom:14px"><select id="uf" style="width:auto" aria-label="Filter"><option value="">All accounts</option><option value="tutor">Tutors</option><option value="student">Students</option></select><button class="btn sm" id="at_">Add tutor</button><button class="btn alt sm" id="as_">Add student</button></div><div class="tbl" id="ut"></div><dialog id="dg"></dialog>`;
    const draw = () => {
      const f = $("#uf").value,
        r = U().filter((x) => !f || x.role === f);
      $("#ut").innerHTML =
        `<table><tr><th>Name</th><th>Role</th><th>Email</th><th>Details</th><th>Upcoming</th><th>Status</th><th></th></tr>${r.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.role}</td><td>${esc(x.email)}</td><td>${x.role === "tutor" ? esc(x.uni + ", " + x.program) + "<br><small>" + money(rateOf(x)) + "/hr</small>" : gl(x.grade)}</td><td>${cnt(x.id)}</td><td>${x.status === "suspended" ? '<span class="badge">Suspended</span>' : '<span class="badge ok">Active</span>'}</td><td class="act"><button class="btn alt sm" data-e="${x.id}">Edit</button><button class="btn alt sm" data-s="${x.id}">${x.status === "suspended" ? "Activate" : "Suspend"}</button><button class="btn alt sm" data-k="${x.id}">Reset password</button><button class="btn alt sm" data-r="${x.id}">Remove</button></td></tr>`).join("") || '<tr><td colspan="7">No accounts yet.</td></tr>'}</table>`;
      const run = async (fn) => {
        try {
          await fn();
          await Promise.all([loadAdmin(), loadMine(), loadPublic()]);
          draw();
        } catch (e) {
          alert(e.message || "Something went wrong.");
        }
      };
      document
        .querySelectorAll("[data-e]")
        .forEach(
          (b) =>
            (b.onclick = () => form(U().find((x) => x.id === b.dataset.e))),
        );
      document.querySelectorAll("[data-s]").forEach(
        (b) =>
          (b.onclick = () => {
            const x = U().find((y) => y.id === b.dataset.s);
            run(() =>
              adminFn("set_status", {
                id: x.id,
                status: x.status === "suspended" ? "active" : "suspended",
              }),
            );
          }),
      );
      document.querySelectorAll("[data-k]").forEach(
        (b) =>
          (b.onclick = async () => {
            const p = prompt("Enter a new temporary password (8+ characters):");
            if (!p) return;
            if (p.length < 8) {
              alert("Too short.");
              return;
            }
            try {
              await adminFn("set_password", { id: b.dataset.k, password: p });
              alert("Password updated. Share it with the user securely.");
            } catch (e) {
              alert(e.message || "Could not update the password.");
            }
          }),
      );
      document.querySelectorAll("[data-r]").forEach(
        (b) =>
          (b.onclick = () => {
            const x = U().find((y) => y.id === b.dataset.r);
            if (
              !confirm(
                "Remove " +
                  x.name +
                  "? Their upcoming sessions will be cancelled.",
              )
            )
              return;
            run(() => adminFn("delete", { id: x.id }));
          }),
      );
    };
    const form = (x) => {
      const nu = !x.id,
        role = x.role,
        dg = $("#dg");
      dg.innerHTML = `<form id="uf2" novalidate method="dialog"><h2>${nu ? "Add " + role : "Edit " + esc(x.name)}</h2><label for="nm">Full name</label><input id="nm" value="${esc(x.name || "")}"><label for="em">Email</label><input id="em" type="email" value="${esc(x.email || "")}">${nu ? '<label for="tp">Temporary password (8+ characters)</label><input id="tp" type="text">' : ""}${role === "student" ? `<label for="gr">Grade</label><select id="gr">${[9, 10, 11, 12].map((g) => `<option ${g === x.grade ? "selected" : ""}>${g}</option>`).join("")}</select>` : tutorFields({ subjects: [], vibe: [], bio: "", ...x }) + `<label for="rO">Hourly rate override (${CFG.currency}, leave blank to use the default ${money(S().rate)})</label><input id="rO" type="number" min="0" value="${x.rate ?? ""}">`}<p class="err" id="er" role="alert"></p><div class="row" style="margin-top:16px"><button class="btn" id="sv">Save</button><button class="btn alt" type="button" id="cx">Cancel</button></div></form>`;
      dg.showModal();
      $("#cx").onclick = () => dg.close();
      let adminFile = null;
      $("#ph") &&
        ($("#ph").onchange = (e) => {
          adminFile = e.target.files[0] || null;
        });
      $("#uf2").onsubmit = async (e) => {
        e.preventDefault();
        const er = $("#er"),
          nm = $("#nm").value.trim(),
          em = $("#em").value.trim().toLowerCase();
        if (!nm || !EMAIL_RE.test(em)) {
          er.textContent = "Add a name and valid email.";
          return;
        }
        if (U().some((y) => y.email === em && y.id !== x.id)) {
          er.textContent = "That email is already used.";
          return;
        }
        er.style.color = "";
        const rec = { name: nm };
        if (nu || em !== x.email) rec.email = em;
        if (role === "student") rec.grade = +$("#gr").value;
        else {
          const t = readTutor(x.photo || "");
          if (!t.uni || !t.program || !t.subjects.length || t.bio.length < 20) {
            er.textContent =
              "Tutor needs university, program, a subject and a short bio.";
            return;
          }
          if (t.payLink && !PAY_LINK_RE.test(t.payLink)) {
            er.textContent =
              "Payment link must be a Stripe link starting with https://buy.stripe.com/";
            return;
          }
          Object.assign(rec, {
            uni: t.uni,
            program: t.program,
            subjects: t.subjects,
            vibe: t.vibe,
            bio: t.bio,
            pay_link: t.payLink || null,
          });
          const r = $("#rO").value;
          rec.rate = r === "" ? null : +r;
        }
        let tp = "";
        if (nu) {
          tp = $("#tp").value;
          if (tp.length < 8) {
            er.textContent = "Temporary password must be 8+ characters.";
            return;
          }
        }
        const sv = $("#sv");
        sv.disabled = true;
        try {
          let id = x.id;
          if (nu)
            id = (await adminFn("create", { role, password: tp, ...rec })).id;
          else await adminFn("update", { id, ...rec });
          if (role === "tutor" && adminFile) {
            er.style.color = "var(--ink)";
            er.textContent = "Uploading photo…";
            const url = await uploadTutorPhoto(adminFile, id);
            if (url) await adminFn("update", { id, photo: url });
          }
          await Promise.all([loadAdmin(), loadPublic(), loadMine()]);
          dg.close();
          draw();
        } catch (err) {
          er.style.color = "";
          er.textContent = err.message || "Could not save.";
          sv.disabled = false;
        }
      };
    };
    $("#at_").onclick = () => form({ role: "tutor" });
    $("#as_").onclick = () => form({ role: "student" });
    $("#uf").onchange = draw;
    draw();
  }
  if (atab === "m") {
    el.innerHTML = DB.messages.length
      ? `<div class="tbl"><table><tr><th>Received</th><th>From</th><th>Message</th></tr>${DB.messages
          .map(
            (x) =>
              `<tr><td>${fmt(Date.parse(x.created_at), s.tz, { dateStyle: "medium", timeStyle: "short" })}</td><td>${esc(x.name)}<br><small><a href="mailto:${esc(x.email)}">${esc(x.email)}</a></small></td><td style="white-space:pre-wrap">${esc(x.message)}</td></tr>`,
          )
          .join("")}</table></div>`
      : '<p class="mut">No messages yet.</p>';
  }
  if (atab === "s") {
    el.innerHTML = `<div class="two" style="max-width:640px">${[
      ["rate", "Default hourly rate (" + CFG.currency + ")"],
      ["len", "Session length (min)"],
      ["buf", "Buffer (min)"],
      ["notice", "Minimum notice (hours)"],
      ["window", "Booking window (days)"],
    ]
      .map(
        ([k, l]) =>
          `<div><label for="s_${k}">${l}</label><input id="s_${k}" type="number" min="0" value="${s[k]}"></div>`,
      )
      .join(
        "",
      )}<div><label for="s_tz">Business time zone</label><input id="s_tz" value="${esc(s.tz)}"></div><div><label for="s_link">Meeting link</label><input id="s_link" value="${esc(s.link)}"></div></div><button class="btn" id="ss" style="margin-top:16px">Save settings</button><h2 style="margin-top:40px;font-size:1.5rem">Admin account</h2><p class="mut">Signed in as ${esc(me().email)}. Change the admin password here.</p><div class="two" style="max-width:640px"><div><label for="ap">New password (8+ characters)</label><input id="ap" type="password" autocomplete="new-password"></div><div><label for="ap2">Confirm</label><input id="ap2" type="password" autocomplete="new-password"></div></div><button class="btn alt" id="cp" style="margin-top:16px">Change admin password</button>`;
    $("#cp").onclick = async () => {
      const p = $("#ap").value;
      if (p.length < 8 || p !== $("#ap2").value) {
        alert("Passwords must match and be 8+ characters.");
        return;
      }
      const { error } = await sb.auth.updateUser({ password: p });
      if (error) {
        alert("Could not change password: " + error.message);
        return;
      }
      $("#ap").value = $("#ap2").value = "";
      alert("Admin password changed.");
    };
    $("#ss").onclick = async () => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: $("#s_tz").value });
      } catch (e) {
        alert("Invalid time zone");
        return;
      }
      const link = $("#s_link").value.trim();
      if (!/^https?:\/\/[^\s"<>]+$/.test(link)) {
        alert("The meeting link must start with http:// or https://");
        return;
      }
      const { error } = await sb.rpc("admin_save_settings", {
        p_rate: +$("#s_rate").value || 40,
        p_len: +$("#s_len").value || 60,
        p_buf: +$("#s_buf").value || 0,
        p_notice: +$("#s_notice").value || 0,
        p_window: +$("#s_window").value || 60,
        p_tz: $("#s_tz").value,
        p_link: link,
      });
      if (error) {
        alert("Could not save: " + error.message);
        return;
      }
      await Promise.all([loadPublic(), loadMine()]);
      alert("Saved");
    };
  }
}
addEventListener(
  "scroll",
  () => $("header").classList.toggle("sc", scrollY > 8),
  { passive: true },
);
(async function init() {
  // Remove the old browser-only data. It held password hashes and test records,
  // and the real data now lives in Supabase.
  ["cv_u", "cv_b", "cv_me", "cv_admin", "cv_set", "cv_msg", "cv_an"].forEach(
    (k) => {
      try {
        localStorage.removeItem(k);
      } catch (_) {}
    },
  );
  const app = $("#app");
  if (!sb) {
    app.innerHTML =
      '<section class="pg"><div class="wrap"><h1 class="h">We can’t load right now</h1><p>Please refresh the page. If this keeps happening, contact Cultivar+.</p></div></section>';
    return;
  }
  app.innerHTML =
    '<section class="pg"><div class="wrap"><p class="mut" role="status">Loading…</p></div></section>';
  try {
    await boot();
  } catch (e) {
    console.error(e);
  }
  // React to sign-in/out that happens elsewhere (another tab, expired session, email link).
  sb.auth.onAuthStateChange((ev, session) => {
    if (AUTH.busy) return;
    if (ev === "SIGNED_OUT" && DB.me)
      setTimeout(() => {
        resetSession();
        nav();
        go();
      }, 0);
    else if (ev === "SIGNED_IN" && session && !DB.me)
      setTimeout(async () => {
        await boot();
        go();
      }, 0);
  });
  go();
})();
