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
      alert("Browser storage is full. Try a smaller photo.");
    }
  },
};
const track = (e) => {
  const a = LS.get("cv_an", {});
  a[e] = (a[e] || 0) + 1;
  LS.set("cv_an", a);
};

// ===== CONFIG =====
const CFG = {
  currency: "CAD",
  supabaseUrl: "https://tginxgkjvhwjzhovbqvi.supabase.co",
  supabaseKey: "sb_publishable_DabNqyM8t7ANJFJpXiOjIA_Jcnk5Xm6",
  checkoutUrl:
    "https://tginxgkjvhwjzhovbqvi.supabase.co/functions/v1/create-checkout",
  stripeLink: "",
  admin: {
    email: "admin@cultivar.example",
    hash: "8f86a3683e12769c4737d78cd12117e6aefa3fcf7b1de7e7025660e2170d45b6",
  },
};

// Initialize Supabase client if loaded
const supabase = window.supabase?.createClient
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey)
  : null;

// Async photo uploader to Supabase 'avatars' bucket
async function uploadTutorPhoto(file, tutorId) {
  if (!supabase) {
    console.warn("Supabase SDK client is not loaded.");
    return "";
  }
  try {
    const fileExt = file.name.split(".").pop();
    const filePath = `tutor-${tutorId || Date.now()}.${fileExt}`;

    const { error } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, { upsert: true, cacheControl: "3600" });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (err) {
    console.error("Storage upload error:", err);
    alert("Photo upload failed: " + err.message);
    return "";
  }
}

// ===== CONTENT =====
const C = {
  tagline: "Academic support from someone who was recently in your shoes.",
  sub: "cultivar+ connects Grade 9 to 12 students with university student tutors who recently took the same courses and made the same transition.",
  overview: [
    "cultivar+ is a tutoring and mentorship service that goes above and beyond, connecting high school students with university student tutors who have recently gone through the same courses, university applications, and transition into post-secondary education.",
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
    "Economics",
    "English / Writing",
    "Other subjects",
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
      "Each tutor sets their own hourly rate, shown on their profile. You pay by credit card after booking.",
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
    [
      "Can I become a tutor?",
      "Yes. Create a tutor account, build your profile, and set your own availability.",
    ],
  ],
  email: "hello@cultivar.example",
  phone: "(000) 000-0000",
};

// ===== DEFAULT AVAILABILITY =====
const DA = {
  1: [16, 20],
  2: [16, 20],
  3: [16, 20],
  4: [16, 20],
  5: [16, 20],
  6: [10, 16],
};

// Empty SEED array so tutors are registered dynamically
const SEED = [];

const U = () => LS.get("cv_u", []),
  setU = (u) => LS.set("cv_u", u),
  B = () => LS.get("cv_b", []),
  setB = (b) => LS.set("cv_b", b);

const allTutors = () => [
    ...SEED,
    ...U().filter((u) => u.role === "tutor" && u.status !== "suspended"),
  ],
  tut = (id) => allTutors().find((t) => t.id === id);

const me = () => {
  const id = LS.get("cv_me", null);
  return id === "admin"
    ? { id: "admin", role: "admin", name: "Admin" }
    : U().find((u) => u.id === id && u.status !== "suspended");
};

const DEF = {
  rate: 40,
  len: 60,
  buf: 15,
  notice: 12,
  window: 60,
  tz: "America/Toronto",
  link: "https://meet.google.com/your-link",
};
const S = () => ({ ...DEF, ...LS.get("cv_set", {}) });
const rid = (p) => p + Math.random().toString(36).slice(2, 8);

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
const hp = (e, p) => sha(e.toLowerCase() + ":" + p);

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
    bk = B().filter((b) => b.tutor === t.id && b.status === "confirmed");
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
const IC = {
  a: '<path d="M6 4v6M3 7h6M15 7h6M4 15l6 6M10 15l-6 6M15 18h6"/>',
  b: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-9V3M7.5 15h9"/>',
  c: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zm0 0A2 2 0 0 0 6 21h13"/>',
  d: '<path d="M12 3l9 5-9 5-9-5zM7 11v5c0 1.5 2.2 3 5 3s5-1.500 5-3v-5"/>',
};

const bloomSvg = () =>
  `<svg class="bloom" viewBox="-60 -60 120 120" aria-hidden="true"><defs><linearGradient id="bg1" x1="0" x2="1"><stop offset="0" stop-color="#ff1a2e"/><stop offset="1" stop-color="#ff5fc0"/></linearGradient></defs><g fill="url(#bg1)">${[0, 90, 180, 270].map((r) => `<path transform="rotate(${r})" d="M0 -8C-26 -22 -22 -54 0 -56C22 -54 26 -22 0 -8Z"/>`).join("")}</g><circle r="11" fill="#ffb3d1"/></svg>`;

const av = (t, c = "av") =>
  t.photo
    ? `<img class="${c} ph" src="${t.photo}" alt="${esc(t.name)}">`
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
      "#app .about .split>*,#app .tc,#app .band,#app .q,#app .bn,#app .steps,#app .steps>div,#app details,#app .cta .wrap>*,#app section>.wrap>h2",
    ),
  ];
  els.forEach((e) => {
    e.classList.add("rv");
    const p = e.parentElement;
    const idx = [...p.children].indexOf(e);
    e.style.setProperty("--d", (idx + 1) * 100 + "ms");
  });
  if (!("IntersectionObserver" in window)) {
    els.forEach((e) => e.classList.add("vis"));
    return;
  }
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((x) => {
        if (x.isIntersecting) {
          x.target.classList.add("vis");
          io.unobserve(x.target);
        }
      }),
    { threshold: 0.1, rootMargin: "0px 0px -4% 0px" },
  );
  els.forEach((e) => io.observe(e));
  if (
    matchMedia("(hover:hover)").matches &&
    !matchMedia("(prefers-reduced-motion:reduce)").matches
  )
    document.querySelectorAll("#app .tc,#app .bn").forEach((c) => {
      c.style.setProperty("--rx", "0deg");
      c.style.setProperty("--ry", "0deg");
      c.onpointermove = (e) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty(
          "--ry",
          ((e.clientX - r.left) / r.width - 0.5) * 7 + "deg",
        );
        c.style.setProperty(
          "--rx",
          -((e.clientY - r.top) / r.height - 0.5) * 7 + "deg",
        );
      };
      c.onpointerleave = () => {
        c.style.setProperty("--rx", "0deg");
        c.style.setProperty("--ry", "0deg");
      };
    });
}

// ===== ROUTER =====
let route = "home",
  arg = null;

function nav() {
  const m = me();
  $("#nv").innerHTML =
    `<a class="l" href="#home">Home</a><a class="l" href="#tutors">Tutors</a><a class="l" href="#faq" data-scroll="faq">FAQ</a>${m ? `<a class="l" href="#${m.role === "admin" ? "admin" : "account"}">Dashboard</a><a class="l" href="#home" id="lo">Log out</a>` : `<a class="l" href="#signup" onclick="sessionStorage.cvrole='tutor'">Become a tutor</a><a class="l" href="#login">Log in</a>`}<a class="btn sm" href="#book" data-track="book">Book a Session</a>`;
  $("#lo")?.addEventListener("click", () => {
    LS.set("cv_me", null);
    nav();
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

function go() {
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
  const m = me();
  if ((r === "account" || r === "paid") && !m) return gate("account");
  if (r === "admin" && m?.role !== "admin") return gate("admin");
  if ((r === "login" || r === "signup") && m) {
    return after();
  }
  route = r;
  nav();
  $("#ft").innerHTML = "cultivar+<br>" + C.email + " · " + C.phone;
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
    }[r] ||
      "cultivar+ | Academic support from someone who was recently in your shoes") +
    (r === "home" ? "" : " | cultivar+");
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
<section class="hero">${[
    [8, 14, 34, "-20deg", 7],
    [88, 10, 26, "30deg", 9],
    [4, 62, 22, "10deg", 8],
    [93, 58, 38, "-35deg", 11],
  ]
    .map(
      ([x, y, s, r, t]) =>
        `<svg class="fp" style="--x:${x}%;--y:${y}%;--s:${s}px;--r:${r};--t:${t}s" viewBox="-30 -60 60 62" aria-hidden="true"><path d="M0 -4C-24 -18 -20 -54 0 -56C20 -54 24 -18 0 -4Z" fill="#ff5fc0"/></svg>`,
    )
    .join("")}<div class="wrap"><div>${bloomSvg()}<h1 class="long">${C.tagline
    .split(" ")
    .map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`)
    .join(
      " ",
    )}</h1><p class="sub">${C.sub}</p><div class="row"><a class="btn" href="#tutors">Meet our tutors</a><a class="btn alt" href="#book" data-track="book">Book a Session</a></div><ul class="facts"><li>Grades 9 to 12</li><li>University student tutors</li><li>Book and pay online</li></ul></div><div class="stack">${T.length ? T.slice(0, 3).map(tcard).join("") : '<p class="mut">Tutors joining soon!</p>'}</div></div></section>
<div class="mq" aria-hidden="true"><div class="tr">${[0, 1].map(() => C.subjects.map((x) => `<span>${x}</span>`).join("")).join("")}</div></div>
<section id="tutors-sec"><div class="wrap"><h2 class="center">Choose a mentor, not just a tutor</h2><p class="mut center">Pick by subject, university, program or personality. Every tutor is a real university student.</p><div class="tg" style="margin-top:36px">${T.length ? T.slice(0, 6).map(tcard).join("") : '<p class="mut center">No tutors registered yet. Create a tutor account to get started!</p>'}</div><p class="center" style="margin-top:32px"><a class="btn alt" href="#tutors">Browse all tutors</a></p></div></section>
<section id="about" class="about"><div class="wrap split"><div><h2>Who we are</h2><div class="tags" style="margin-top:18px">${C.words.map((w) => `<span class="tag">${w}</span>`).join("")}</div></div><div>${C.overview.map((p) => `<p>${p}</p>`).join("")}<h3 style="margin-top:28px">Our mission</h3>${C.mission.map((p) => `<p>${p}</p>`).join("")}</div></div></section>
<section><div class="wrap"><h2 class="center">What we help with</h2><p class="mut center">Senior-level courses, plus the things school doesn't always teach.</p><div class="bento">${[
    [
      "Math",
      "Advanced Functions and Calculus & Vectors, taught by someone who just finished them.",
      "a",
    ],
    [
      "Sciences",
      "Biology and Chemistry with clear explanations and exam strategy.",
      "b",
    ],
    [
      "Business & English",
      "Essays, discussion, projects and confident writing.",
      "c",
    ],
    [
      "University mentorship",
      "Applications, choosing a program, study habits and student life, straight from students living it.",
      "d",
    ],
  ]
    .map(
      ([h, p, i], k) =>
        `<div class="bn b${k}"><svg class="bg" viewBox="0 0 24 24" aria-hidden="true">${IC[i]}</svg><div class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[i]}</svg></div><h3>${h}</h3><p>${p}</p></div>`,
    )
    .join("")}</div></div></section>
<section class="about"><div class="wrap"><h2>How it works</h2><div class="steps four"><div><h3>Browse tutors</h3><p class="mut">Filter by subject, university and interests.</p></div><div><h3>Read a profile</h3><p class="mut">Meet the person behind the subject.</p></div><div><h3>Book a time</h3><p class="mut">See live availability and pick a slot.</p></div><div><h3>Pay and learn</h3><p class="mut">Pay by card after booking, then meet online.</p></div></div></div></section>
<section><div class="wrap"><h2>What students say</h2><div class="qg">${C.quotes.map((q) => `<div class="q"><blockquote>“${q[0]}”</blockquote><cite>${q[1]}</cite></div>`).join("")}</div></div></section>
<section id="faq" class="about"><div class="wrap split"><h2>Questions, answered</h2><div>${C.faq.map((f) => `<details><summary>${f[0]}</summary><p>${f[1]}</p></details>`).join("")}</div></div></section>
<section class="cta" id="contact"><div class="wrap"><div><h2>Ready to grow?</h2><p>Find the tutor who feels right and book in minutes. University student? Join as a tutor.</p><div class="row"><a class="btn white" href="#tutors">Find a tutor</a><a class="btn white" style="background:none;color:#fff" href="#signup" onclick="sessionStorage.cvrole='tutor'">Become a tutor</a></div><p style="margin-top:24px">${C.email}<br>${C.phone}</p></div>
<form id="cf" novalidate><label for="cn">Name</label><input id="cn"><label for="ce">Email</label><input id="ce" type="email"><label for="cm">Message</label><textarea id="cm" rows="4"></textarea><p class="err" id="cerr" role="alert"></p><button class="btn">Send message</button></form></div></section>`;
  fx();
  $("#cf").onsubmit = (e) => {
    e.preventDefault();
    if (
      !(
        $("#cn").value.trim() &&
        /^\S+@\S+\.\S+$/.test($("#ce").value) &&
        $("#cm").value.trim()
      )
    ) {
      $("#cerr").textContent =
        "Please add your name, a valid email, and a message.";
      return;
    }
    const m = LS.get("cv_msg", []);
    m.push({
      n: $("#cn").value,
      e: $("#ce").value,
      m: $("#cm").value,
      at: Date.now(),
    });
    LS.set("cv_msg", m);
    $("#cf").innerHTML =
      "<h3>Thank you!</h3><p>We got your message. (Demo: saved in this browser.)</p>";
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
      : "<p>No tutors match yet. Try clearing a filter or signing up as a tutor.</p>";
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
    `<section class="pg"><div class="wrap prof"><aside class="card pcard">${av(t, "av big")}<h1 class="h" style="font-size:2rem">${esc(t.name)}</h1><p class="uni">${esc(t.uni)}<br>${esc(t.program)}</p><p><b>${money(rateOf(t))}</b> <span class="mut">per hour</span></p><a class="btn" style="width:100%" href="#book" data-track="book" onclick="pick('${t.id}')">Book a Session</a></aside><div><h2>About ${esc(t.name.split(" ")[0])}</h2><p class="lead">${esc(t.bio)}</p><h3>Subjects</h3>${tags(t.subjects)}<h3 style="margin-top:24px">A bit about them</h3>${tags(t.vibe)}<h3 style="margin-top:24px">Happy to talk about</h3>${tags(["University applications", "Choosing a program", "Study habits", "Student life"])}<h3 style="margin-top:24px">Next available (${esc(tz)})</h3>${sl.length ? `<div class="tags">${sl.map((ms) => `<span class="tag">${fmt(ms, tz, { weekday: "short", month: "short", day: "numeric" })}, ${tm(ms, tz)}</span>`).join("")}</div>` : '<p class="mut">No open times right now.</p>'}</div></div></section>`;
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
    if (!window.crypto?.subtle) {
      er.textContent = "Needs https or localhost.";
      return;
    }
    let f = LS.get("cv_fail", { n: 0, until: 0 });
    if (Date.now() < f.until) {
      er.textContent = "Too many attempts. Try again in a minute.";
      return;
    }
    let ok = null;
    if (
      em === CFG.admin.email &&
      (await sha(pw)) === (LS.get("cv_admin", {}).hash || CFG.admin.hash)
    )
      ok = "admin";
    else {
      const u = U().find((u) => u.email === em);
      if (u && u.pw === (await hp(em, pw))) {
        if (u.status === "suspended") {
          er.textContent =
            "This account is suspended. Please contact cultivar+.";
          return;
        }
        ok = u.id;
      }
    }
    if (ok) {
      LS.set("cv_me", ok);
      LS.set("cv_fail", { n: 0, until: 0 });
      after();
    } else {
      f.n++;
      if (f.n >= 5) f = { n: 0, until: Date.now() + 6e4 };
      LS.set("cv_fail", f);
      er.textContent = "Incorrect email or password.";
    }
  };
}

const tutorFields = (t) =>
  `<label for="un">University</label><input id="un" value="${esc(t.uni)}" placeholder="e.g. University of Toronto"><label for="pr">Program and year</label><input id="pr" value="${esc(t.program)}" placeholder="e.g. Life Sciences, Year 2"><fieldset class="fs"><legend>Subjects you tutor</legend>${C.subjects.map((s) => `<label class="chk"><input type="checkbox" name="sj" value="${s}" ${t.subjects?.includes(s) ? "checked" : ""}><span>${s}</span></label>`).join("")}</fieldset><label for="vb">Personality and interests (comma separated)</label><input id="vb" value="${esc((t.vibe || []).join(", "))}" placeholder="Patient, chess club, loves coffee"><label for="bi">Short bio</label><textarea id="bi" rows="4" maxlength="400">${esc(t.bio)}</textarea><label for="ph">Profile photo</label><input id="ph" type="file" accept="image/*"><label for="pl">Your Stripe Payment Link (optional)</label><input id="pl" value="${esc(t.payLink || "")}" placeholder="https://buy.stripe.com/...">`;

function readTutor(ph) {
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
    ...(ph ? { photo: ph } : {}),
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
      pw = $("#pw").value,
      u = U();
    if (!nm || !/^\S+@\S+\.\S+$/.test(em)) {
      er.textContent = "Please add your name and a valid email.";
      return;
    }
    if (pw.length < 8) {
      er.textContent = "Password must be at least 8 characters.";
      return;
    }
    if (u.some((x) => x.email === em) || em === CFG.admin.email) {
      er.textContent = "That email already has an account. Try logging in.";
      return;
    }
    if (!$("#ck").checked) {
      er.textContent = "Please accept the terms to continue.";
      return;
    }

    const userId = rid(role === "tutor" ? "u" : "s");
    let photoUrl = "";
    if (role === "tutor" && selectedFile) {
      er.style.color = "var(--ink)";
      er.textContent = "Uploading photo to Supabase...";
      photoUrl = await uploadTutorPhoto(selectedFile, userId);
    }

    let rec = {
      id: userId,
      role,
      name: nm,
      email: em,
      pw: await hp(em, pw),
      created: Date.now(),
    };
    if (role === "student") rec.grade = +$("#gr").value;
    else {
      const t = readTutor(photoUrl);
      if (!t.uni || !t.program || !t.subjects.length || t.bio.length < 20) {
        er.style.color = "#b00020";
        er.textContent =
          "Tutors: add your university, program, at least one subject, and a short bio.";
        return;
      }
      Object.assign(rec, t, { avail: DA, blocked: [] });
    }
    u.push(rec);
    setU(u);
    LS.set("cv_me", rec.id);
    track("signup_" + role);
    after();
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
  return `<aside class="side"><img src="assets/logo.png" alt="cultivar+"><h3>Tutoring session</h3>${t ? `<div class="mini">${av(t, "av sm")}<div><b>${esc(t.name)}</b><br><small>${esc(t.uni)}</small></div></div>` : ""}<dl><dt>Duration</dt><dd>${S().len} minutes</dd>${t ? `<dt>Price</dt><dd>${money(price(t))}</dd>` : ""}${st.subject ? `<dt>Subject</dt><dd>${esc(st.subject)}${st.grade ? ", " + gl(st.grade) : ""}</dd>` : ""}${st.slot ? `<dt>When</dt><dd>${fmt(st.slot, st.tz, { weekday: "long", month: "long", day: "numeric" })}<br>${tm(st.slot, st.tz)}</dd>` : ""}<dt>Time zone</dt><dd>${esc(st.tz)}</dd></dl></aside>`;
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
  if (m?.role === "tutor") {
    $("#app").innerHTML =
      '<section class="pg"><div class="wrap"><h1 class="h">Booking is for students</h1><p>You are signed in as a tutor. Log out and use a student account to book sessions.</p><a class="btn" href="#account">Go to your dashboard</a></div></section>';
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
    `<h2>Choose your tutor</h2><div class="pick">${T.length ? T.map((x) => `<button class="pk ${x.id === st.tutor ? "sel" : ""}" data-t="${x.id}" aria-pressed="${x.id === st.tutor}">${av(x, "av sm")}<span><b>${esc(x.name)}</b><br><small>${esc(x.uni)} · ${esc(x.program)}</small><br><small>${esc(x.subjects.join(", "))} · ${money(rateOf(x))}/hr</small></span></button>`).join("") : '<p class="mut">No tutors available to book yet.</p>'}</div>${t ? `<div class="two"><div><label for="sj">Subject</label><select id="sj"><option value="">Select…</option>${t.subjects.map((s) => `<option ${s === st.subject ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div><div><label for="gd">Your grade</label><select id="gd"><option value="">Select…</option>${[9, 10, 11, 12].map((g) => `<option value="${g}" ${g === st.grade ? "selected" : ""}>${gl(g)}</option>`).join("")}</select></div></div>` : ""}<div class="nav2"><span></span><button class="btn" id="nx" ${t && st.subject && st.grade ? "" : "disabled"}>Next</button></div>`;
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
  $("#cf").onclick = () => {
    st.notes = $("#nt").value;
    st.fm = $("#fm").value;
    const bs = B(),
      s = S(),
      en = st.slot + s.len * 6e4;
    if (slotsFor(t).indexOf(st.slot) < 0) {
      alert("Sorry, that time was just taken. Please pick another.");
      st.slot = null;
      st.step = 2;
      step();
      return;
    }
    if (
      bs.some(
        (b) =>
          b.student === m.id &&
          b.status === "confirmed" &&
          dkey(b.start, st.tz) === dkey(st.slot, st.tz),
      )
    ) {
      $("#e").textContent = "You already have a session that day.";
      return;
    }
    const b = {
      id: "CV-" + rid("").toUpperCase(),
      tutor: t.id,
      tutorName: t.name,
      student: m.id,
      studentName: m.name,
      email: m.email,
      grade: st.grade,
      subject: st.subject,
      start: st.slot,
      end: en,
      format: st.fm,
      notes: st.notes,
      status: "confirmed",
      paid: "unpaid",
      amount: price(t),
      created: Date.now(),
      tz: st.tz,
    };
    bs.push(b);
    setB(bs);
    st.ref = b.id;
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
        const bk = B().find((x) => x.id === a.dataset.stripe),
          t = tut(bk.tutor),
          old = a.textContent;
        a.disabled = true;
        a.textContent = "Opening Stripe…";
        try {
          const d = await (
            await fetch(CFG.checkoutUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "create",
                ref: bk.id,
                amount_cents: Math.round(bk.amount * 100),
                tutor_name: bk.tutorName,
                tutor_email: t?.email || "",
                student_name: bk.studentName,
                student_email: bk.email,
                subject: bk.subject,
                session_date: fmt(bk.start, bk.tz, { dateStyle: "full" }),
                session_time: tm(bk.start, bk.tz),
                email: bk.email,
                path: location.pathname,
                // --- METADATA PASSED TO STRIPE ---
                metadata: {
                  studentEmail: bk.email,
                  studentName: bk.studentName,
                  tutorEmail: t?.email || "",
                  tutorName: bk.tutorName,
                  subject: bk.subject,
                  date: fmt(bk.start, bk.tz, { dateStyle: "full" }),
                  time: tm(bk.start, bk.tz),
                  ref: bk.id,
                },
              }),
            })
          ).json();
          if (!d.url) throw new Error(d.error || "No checkout link returned");
          LS.set("cv_paying", bk.id);
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
    .forEach((a) => (a.onclick = () => setPaid(a.dataset.demo, "paid", cb)));
}

function setPaid(id, v, cb) {
  const bs = B();
  bs.find((x) => x.id === id).paid = v;
  setB(bs);
  cb();
}

function s4() {
  const b = B().find((x) => x.id === st.ref);
  $("#bs").innerHTML =
    `<div class="done-wrap"><div class="okc" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><div class="burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div><h2>You're booked. Now pay to lock it in.</h2><p>Reference <b>${b.id}</b>. Pay securely by credit card. ${CFG.stripeLink ? "" : '<span class="badge">Demo mode: no real payment is taken</span>'}</p><div class="row" id="pb">${payBtns(b)}<button class="btn alt" id="lt">Pay later</button></div><div id="pc"></div>`;
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
  const gc = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("cultivar+ with " + b.tutorName)}&dates=${z(b.start)}/${z(b.end)}&details=${encodeURIComponent(s.link)}`;
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
          `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//cultivar+//EN\r\nBEGIN:VEVENT\r\nUID:${b.id}@cultivar\r\nDTSTAMP:${z(Date.now())}\r\nDTSTART:${z(b.start)}\r\nDTEND:${z(b.end)}\r\nSUMMARY:cultivar+ with ${b.tutorName}\r\nDESCRIPTION:${s.link}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
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
  const m = me(),
    cs = new URLSearchParams(location.search).get("cs");
  history.replaceState(null, "", location.pathname + "#paid");
  const id = LS.get("cv_paying", null),
    bs = B(),
    b = bs.find((x) => x.id === id && x.student === m.id);
  let msg =
    "We could not find a pending payment. If you were charged, contact cultivar+.";
  if (b && b.paid === "unpaid") {
    if (cs && CFG.checkoutUrl) {
      try {
        const r = await fetch(CFG.checkoutUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "verify", session_id: cs }),
          }),
          d = await r.json();
        if (
          d.paid &&
          d.ref === b.id &&
          d.amount_cents === Math.round(b.amount * 100)
        ) {
          b.paid = "paid";
          msg = "Payment confirmed. Thank you!";
        } else
          msg =
            "We could not confirm your payment yet. If you were charged, contact cultivar+.";
      } catch (e) {
        b.paid = "review";
        msg = "Thanks! Your payment is being confirmed.";
      }
    } else {
      b.paid = "review";
      msg = "Thanks! Your payment is being confirmed. Your session is booked.";
    }
    setB(bs);
  }
  LS.set("cv_paying", null);
  sessionStorage.cvmsg = msg;
  location.hash = "account";
}

// ===== DASHBOARDS =====
let tab = "sessions";
const cancel = (id) => {
  if (!confirm("Cancel this session?")) return;
  const bs = B();
  bs.find((x) => x.id === id).status = "cancelled";
  setB(bs);
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
    const upd = (f) => {
      const u = U(),
        x = u.find((y) => y.id === m.id);
      f(x);
      setU(u);
    };
    $("#sv").onclick = () => {
      const h = {};
      for (let i = 0; i < 7; i++) {
        const a = $(`[data-h="${i}0"]`).value,
          b = $(`[data-h="${i}1"]`).value;
        h[i] = a !== "" && b !== "" && +b > +a ? [+a, +b] : null;
      }
      upd((x) => (x.avail = h));
      $("#sv").textContent = "Saved ✓";
    };
    $("#bl").onclick = () => {
      const d = $("#bd").value;
      if (d) {
        upd((x) => (x.blocked = [...new Set([...(x.blocked || []), d])]));
        account();
      }
    };
    document.querySelectorAll("[data-u]").forEach(
      (b) =>
        (b.onclick = () => {
          upd((x) => (x.blocked = x.blocked.filter((y) => y !== b.dataset.u)));
          account();
        }),
    );
  }
  if (tab === "profile") {
    el.innerHTML = `<form id="pf" style="max-width:620px"><p class="note">Your session rate is set by cultivar+ (currently ${money(rateOf(m))} per hour).</p><label for="nm">Name</label><input id="nm" value="${esc(m.name)}">${tutorFields(m)}<p class="err" id="er" role="alert"></p><button class="btn" style="margin-top:14px">Save profile</button></form>`;
    let profileFile = null;
    $("#ph").onchange = (e) => {
      profileFile = e.target.files[0] || null;
    };
    $("#pf").onsubmit = async (e) => {
      e.preventDefault();
      const er = $("#er");
      let photoUrl = m.photo || "";

      if (profileFile) {
        er.style.color = "var(--ink)";
        er.textContent = "Uploading new photo...";
        photoUrl = await uploadTutorPhoto(profileFile, m.id);
      }

      const t = readTutor(photoUrl);
      if (!t.subjects.length || t.bio.length < 20) {
        er.style.color = "#b00020";
        er.textContent = "Add at least one subject and a short bio.";
        return;
      }
      const u = U();
      Object.assign(
        u.find((y) => y.id === m.id),
        t,
        { name: $("#nm").value.trim() || m.name },
      );
      setU(u);
      er.style.color = "#0a7a3d";
      er.textContent = "Saved ✓";
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
    an = LS.get("cv_an", {}),
    s = S();
  $("#app").innerHTML =
    `<section class="adm"><div class="wrap"><div class="row between"><h1 class="h" style="margin:0">Admin</h1></div><div class="tabs">${[
      ["b", "Bookings"],
      ["u", "Users"],
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
    el.innerHTML = `<p class="note">Home views ${an.page_home || 0} · Book clicks ${an.book_click || 0} · Bookings ${an.booking_done || 0} · Sign-ups ${(an.signup_student || 0) + (an.signup_tutor || 0)} · Paid total ${money(paidT)}</p><div class="row" style="margin-bottom:14px"><button class="btn alt sm" id="csv">Export CSV</button></div><div class="tbl">${bs.length ? `<table><tr><th>Ref</th><th>When (${s.tz})</th><th>Tutor</th><th>Student</th><th>Status</th><th>Payment</th><th></th></tr>${bs.map((b) => `<tr><td>${b.id}</td><td>${fmt(b.start, s.tz, { dateStyle: "medium", timeStyle: "short" })}</td><td>${esc(b.tutorName)}</td><td>${esc(b.studentName)}<br><small>${esc(b.email)}</small></td><td>${b.status}</td><td>${b.paid}</td><td class="act">${b.paid !== "paid" && b.status === "confirmed" ? `<button class="btn sm" data-p="${b.id}">Mark paid</button>` : ""}${b.status === "confirmed" ? `<button class="btn alt sm" data-c="${b.id}">Cancel</button>` : ""}</td></tr>`).join("")}</table>` : '<p style="padding:16px">No bookings yet.</p>'}</div>`;
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
    const bk = B(),
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
      const upd = (id, fn) => {
        const a = U();
        fn(a.find((x) => x.id === id));
        setU(a);
        draw();
      };
      document
        .querySelectorAll("[data-e]")
        .forEach(
          (b) =>
            (b.onclick = () => form(U().find((x) => x.id === b.dataset.e))),
        );
      document
        .querySelectorAll("[data-s]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              upd(
                b.dataset.s,
                (x) =>
                  (x.status =
                    x.status === "suspended" ? "active" : "suspended"),
              )),
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
            const x = U().find((y) => y.id === b.dataset.k),
              h = await hp(x.email, p);
            upd(x.id, (y) => (y.pw = h));
            alert("Password updated. Share it with the user securely.");
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
            const bs = B();
            bs.forEach((y) => {
              if (
                y.status === "confirmed" &&
                y.end > Date.now() &&
                (y.student === x.id || y.tutor === x.id)
              )
                y.status = "cancelled";
            });
            setB(bs);
            setU(U().filter((y) => y.id !== x.id));
            draw();
          }),
      );
    };
    const form = (x) => {
      const nu = !x.id,
        role = x.role,
        dg = $("#dg");
      dg.innerHTML = `<form id="uf2" novalidate method="dialog"><h2>${nu ? "Add " + role : "Edit " + esc(x.name)}</h2><label for="nm">Full name</label><input id="nm" value="${esc(x.name || "")}"><label for="em">Email</label><input id="em" type="email" value="${esc(x.email || "")}">${nu ? '<label for="tp">Temporary password (8+ characters)</label><input id="tp" type="text">' : ""}${role === "student" ? `<label for="gr">Grade</label><select id="gr">${[9, 10, 11, 12].map((g) => `<option ${g === x.grade ? "selected" : ""}>${g}</option>`).join("")}</select>` : tutorFields({ subjects: [], vibe: [], bio: "", ...x }) + `<label for="rO">Hourly rate override (${CFG.currency}, leave blank to use default ${money(S().rate)})</label><input id="rO" type="number" min="0" value="${x.rate ?? ""}">`}<p class="err" id="er" role="alert"></p><div class="row" style="margin-top:16px"><button class="btn" id="sv">Save</button><button class="btn alt" type="button" id="cx">Cancel</button></div></form>`;
      dg.showModal();
      $("#cx").onclick = () => dg.close();

      let adminSelectedFile = null;
      $("#ph") &&
        ($("#ph").onchange = (e) => {
          adminSelectedFile = e.target.files[0] || null;
        });

      $("#uf2").onsubmit = async (e) => {
        e.preventDefault();
        const er = $("#er"),
          nm = $("#nm").value.trim(),
          em = $("#em").value.trim().toLowerCase(),
          a = U();
        if (!nm || !/^\S+@\S+\.\S+$/.test(em)) {
          er.textContent = "Add a name and valid email.";
          return;
        }
        if (
          a.some((y) => y.email === em && y.id !== x.id) ||
          em === CFG.admin.email
        ) {
          er.textContent = "That email is already used.";
          return;
        }

        const targetId = x.id || rid(role === "tutor" ? "u" : "s");
        let photoUrl = x.photo || "";

        if (role === "tutor" && adminSelectedFile) {
          er.style.color = "var(--ink)";
          er.textContent = "Uploading photo to Supabase...";
          photoUrl = await uploadTutorPhoto(adminSelectedFile, targetId);
        }

        let rec = { ...x, name: nm, email: em };
        if (role === "student") rec.grade = +$("#gr").value;
        else {
          const t = readTutor(photoUrl);
          if (!t.uni || !t.program || !t.subjects.length || t.bio.length < 20) {
            er.style.color = "#b00020";
            er.textContent =
              "Tutor needs university, program, a subject and a short bio.";
            return;
          }
          Object.assign(rec, t);
          const r = $("#rO").value;
          rec.rate = r === "" ? undefined : +r;
          if (nu) Object.assign(rec, { avail: DA, blocked: [] });
        }

        if (nu) {
          const p = $("#tp").value;
          if (p.length < 8) {
            er.style.color = "#b00020";
            er.textContent = "Temporary password must be 8+ characters.";
            return;
          }
          Object.assign(rec, {
            id: targetId,
            pw: await hp(em, p),
            created: Date.now(),
          });
          a.push(rec);
        } else a[a.findIndex((y) => y.id === x.id)] = rec;

        setU(a);
        dg.close();
        draw();
      };
    };
    $("#at_").onclick = () => form({ role: "tutor" });
    $("#as_").onclick = () => form({ role: "student" });
    $("#uf").onchange = draw;
    draw();
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
      )}<div><label for="s_tz">Business time zone</label><input id="s_tz" value="${s.tz}"></div><div><label for="s_link">Meeting link</label><input id="s_link" value="${esc(s.link)}"></div></div><button class="btn" id="ss" style="margin-top:16px">Save settings</button><h2 style="margin-top:40px;font-size:1.5rem">Admin account</h2><p class="mut">Signed in as ${CFG.admin.email}. Change the admin password here.</p><div class="two" style="max-width:640px"><div><label for="ap">New password (8+ characters)</label><input id="ap" type="password" autocomplete="new-password"></div><div><label for="ap2">Confirm</label><input id="ap2" type="password" autocomplete="new-password"></div></div><button class="btn alt" id="cp" style="margin-top:16px">Change admin password</button>`;
    $("#cp").onclick = async () => {
      const p = $("#ap").value;
      if (p.length < 8 || p !== $("#ap2").value) {
        alert("Passwords must match and be 8+ characters.");
        return;
      }
      LS.set("cv_admin", { hash: await sha(p) });
      $("#ap").value = $("#ap2").value = "";
      alert("Admin password changed.");
    };
    $("#ss").onclick = () => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: $("#s_tz").value });
      } catch (e) {
        alert("Invalid time zone");
        return;
      }
      LS.set("cv_set", {
        ...LS.get("cv_set", {}),
        rate: +$("#s_rate").value || 40,
        len: +$("#s_len").value || 60,
        buf: +$("#s_buf").value,
        notice: +$("#s_notice").value,
        window: +$("#s_window").value || 60,
        tz: $("#s_tz").value,
        link: $("#s_link").value,
      });
      alert("Saved");
    };
  }
}

addEventListener(
  "scroll",
  () => $("header").classList.toggle("sc", scrollY > 8),
  { passive: true },
);
go();
