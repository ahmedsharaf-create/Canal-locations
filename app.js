import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAILS, DEFAULT_SHOPS } from "./firebase-config.js";

// ---------- Firebase init ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Secondary app instance used only for creating new Auth accounts from the
// Users tab, so doing so doesn't sign the admin out of their own session.
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

const ADMIN_EMAILS_LC = ADMIN_EMAILS.map(e => e.toLowerCase());

let state = {
  currentUser: null,     // Firebase auth user
  profile: null,         // Firestore users/{uid} doc data
  shops: [],
  submissions: [],
  agents: [],
  allUsers: [],
  selectedShift: null,
  capturedLocation: null,
  locating: false
};

const $ = (id) => document.getElementById(id);
const todayStr = () => new Date().toISOString().slice(0, 10);
const formatDate = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
const formatTime = (timestamp) => {
  if (!timestamp || typeof timestamp.toDate !== "function") return "—";
  return timestamp.toDate().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- Boot: decide setup vs login ----------
(async function boot() {
  try {
    const setupSnap = await getDoc(doc(db, "meta", "setup"));
    if (!setupSnap.exists() || !setupSnap.data().completed) {
      $("setupScreen").classList.remove("hidden");
      $("loginScreen").classList.add("hidden");
    }
  } catch (e) {
    // Firestore not reachable / rules not deployed yet — fall back to login screen.
    console.error(e);
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await handleSignedIn(user);
    } else {
      state.currentUser = null;
      state.profile = null;
      $("mainApp").classList.add("hidden");
      if ($("setupScreen").classList.contains("hidden")) {
        $("loginScreen").classList.remove("hidden");
      }
    }
  });
})();

async function handleSignedIn(user) {
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists()) {
    showToast("Your account has been deactivated. Contact an admin.");
    await signOut(auth);
    return;
  }
  state.currentUser = user;
  state.profile = profileSnap.data();
  await ensureShopsSeeded();
  await enterApp();
}

async function ensureShopsSeeded() {
  const shopsSnap = await getDocs(collection(db, "shops"));
  if (shopsSnap.empty) {
    for (const name of DEFAULT_SHOPS) {
      await addDoc(collection(db, "shops"), { name });
    }
  }
}

// ---------- Setup (first admin) ----------
$("setupBtn").addEventListener("click", async () => {
  const email = $("setupEmail").value.trim().toLowerCase();
  const name = $("setupName").value.trim();
  const password = $("setupPassword").value;
  const errEl = $("setupError");
  errEl.classList.add("hidden");

  if (!email || !name || !password) {
    errEl.textContent = "Fill in all fields.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!ADMIN_EMAILS_LC.includes(email)) {
    errEl.textContent = "This email isn't on the authorized admin list.";
    errEl.classList.remove("hidden");
    return;
  }
  if (password.length < 6) {
    errEl.textContent = "Password must be at least 6 characters.";
    errEl.classList.remove("hidden");
    return;
  }

  $("setupBtn").disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), { email, name, role: "admin" });
    await setDoc(doc(db, "meta", "setup"), { completed: true });
    showToast("Admin account created.");
    // onAuthStateChanged will pick this up and enter the app.
  } catch (e) {
    errEl.textContent = friendlyAuthError(e);
    errEl.classList.remove("hidden");
  } finally {
    $("setupBtn").disabled = false;
  }
});

// ---------- Login ----------
$("loginBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const errEl = $("loginError");
  errEl.classList.add("hidden");
  if (!email || !password) {
    errEl.textContent = "Enter both email and password.";
    errEl.classList.remove("hidden");
    return;
  }
  $("loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    errEl.textContent = friendlyAuthError(e);
    errEl.classList.remove("hidden");
  } finally {
    $("loginBtn").disabled = false;
  }
});

[$("loginEmail"), $("loginPassword")].forEach(el => {
  el.addEventListener("keydown", e => { if (e.key === "Enter") $("loginBtn").click(); });
});

$("forgotPwLink").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const infoEl = $("loginInfo");
  const errEl = $("loginError");
  errEl.classList.add("hidden");
  if (!email) {
    errEl.textContent = "Enter your email above first, then tap Forgot password.";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    infoEl.textContent = "Password reset email sent — check your inbox.";
    infoEl.classList.remove("hidden");
  } catch (e) {
    errEl.textContent = friendlyAuthError(e);
    errEl.classList.remove("hidden");
  }
});

$("logoutBtn").addEventListener("click", () => signOut(auth));

function friendlyAuthError(e) {
  const code = e && e.code ? e.code : "";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Incorrect email or password.";
  if (code.includes("user-not-found")) return "No account found with that email.";
  if (code.includes("email-already-in-use")) return "That email is already registered.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("too-many-requests")) return "Too many attempts. Try again later.";
  if (code.includes("network-request-failed")) return "Network error — check your connection.";
  return "Something went wrong. Please try again.";
}

function isAdmin() { return state.profile && state.profile.role === "admin"; }

async function enterApp() {
  $("setupScreen").classList.add("hidden");
  $("loginScreen").classList.add("hidden");
  $("mainApp").classList.remove("hidden");
  $("currentUserName").textContent = state.profile.name || state.profile.email;
  $("currentUserRole").textContent = state.profile.role.toUpperCase();
  $("fAgent").value = state.profile.name || "";
  $("fDate").value = todayStr();

  ["navDashboard", "navSchedule", "navShops", "navUsers"].forEach(id => $(id).classList.toggle("hidden", !isAdmin()));

  await refreshShops();
  populateShopSelects();
  goToPage("submit");
}

// ---------- Nav ----------
document.querySelectorAll(".navbtn").forEach(btn => {
  btn.addEventListener("click", () => goToPage(btn.dataset.page));
});

async function goToPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  document.querySelectorAll(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $("page-" + page).classList.remove("hidden");
  if (page === "dashboard") { await refreshSubmissions(); renderDashboard(); }
  if (page === "mysubmissions") { await refreshSubmissions(); renderMyDashboard(); }
  if (page === "schedule") {
    if (!$("scheduleDate").value) $("scheduleDate").value = todayStr();
    await Promise.all([refreshSubmissions(), refreshShops(), refreshAgents()]);
    populateScheduleShopFilter();
    renderSchedule();
  }
  if (page === "shops") { await refreshShops(); renderShopsList(); populateShopSelects(); }
  if (page === "users") { await refreshUsersList(); }
}

// ---------- Data loaders ----------
async function refreshShops() {
  const snap = await getDocs(collection(db, "shops"));
  state.shops = snap.docs.map(d => ({ id: d.id, name: d.data().name })).sort((a, b) => a.name.localeCompare(b.name));
}

async function refreshSubmissions() {
  const snap = await getDocs(query(collection(db, "submissions"), orderBy("createdAt", "desc")));
  state.submissions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function refreshAgents() {
  const snap = await getDocs(query(collection(db, "users"), where("role", "==", "agent")));
  state.agents = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function populateShopSelects() {
  const opts = state.shops.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
  $("fShop").innerHTML = opts || `<option value="">No shops yet</option>`;
  $("filterShop").innerHTML = `<option value="">All shops</option>` + opts;
}

function populateScheduleShopFilter() {
  const opts = state.shops.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
  $("scheduleShopFilter").innerHTML = `<option value="">All shops</option>` + opts;
}

// ---------- Submit form: geolocation + write ----------
document.querySelectorAll(".shift-opt").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".shift-opt").forEach(o => o.classList.remove("selected"));
    el.classList.add("selected");
    state.selectedShift = el.dataset.shift;
  });
});

function captureLocation() {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  const getPosition = (options) => new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy)
      }),
      () => resolve(null),
      options
    );
  });
  return getPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
    .then(loc => loc || getPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }));
}

$("submitFormBtn").addEventListener("click", async () => {
  const date = $("fDate").value;
  const agent = $("fAgent").value.trim();
  const shop = $("fShop").value;
  const shift = state.selectedShift;
  const statusEl = $("locStatus");

  if (!date || !agent || !shop || !shift) {
    showToast("Fill in date, agent name, shop, and shift.");
    return;
  }

  $("submitFormBtn").disabled = true;
  statusEl.className = "loc-status";
  statusEl.innerHTML = `<span class="spinner"></span> Getting your location…`;

  const location = await captureLocation();
  if (!location) {
    statusEl.className = "loc-status err";
    statusEl.textContent = "We couldn't get your location. Please enable location access for this site and try again — location is required to submit.";
    showToast("Location is required to submit an entry.");
    $("submitFormBtn").disabled = false;
    return;
  }
  statusEl.className = "loc-status ok";
  statusEl.textContent = `Location captured (±${location.accuracy}m).`;

  try {
    await addDoc(collection(db, "submissions"), {
      date, agentName: agent, shopName: shop, shift,
      location,
      submittedBy: state.profile.email,
      submittedByName: state.profile.name || state.profile.email,
      createdAt: serverTimestamp()
    });
    showToast("Entry submitted.");
    document.querySelectorAll(".shift-opt").forEach(o => o.classList.remove("selected"));
    state.selectedShift = null;
  } catch (e) {
    console.error(e);
    showToast("Couldn't submit — check your connection and try again.");
  } finally {
    $("submitFormBtn").disabled = false;
  }
});

// ---------- Dashboard ----------
function getFilteredSubmissions() {
  const from = $("filterFrom").value;
  const to = $("filterTo").value;
  const shop = $("filterShop").value;
  const shift = $("filterShift").value;
  return state.submissions.filter(s => {
    if (from && s.date < from) return false;
    if (to && s.date > to) return false;
    if (shop && s.shopName !== shop) return false;
    if (shift && s.shift !== shift) return false;
    return true;
  }).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
}

function tsMillis(timestamp) {
  return (timestamp && typeof timestamp.toDate === "function") ? timestamp.toDate().getTime() : 0;
}

function renderDashboard() {
  const rows = getFilteredSubmissions();
  const body = $("dashboardBody");
  body.innerHTML = "";
  $("dashboardEmpty").classList.toggle("hidden", rows.length > 0);

  rows.forEach(s => {
    const shiftLabel = s.shift === "Full" ? "Full day" : s.shift;
    const loc = s.location
      ? `<a class="loc-pill" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${s.location.lat},${s.location.lng}">📍 View map</a>`
      : `<span class="loc-none">No location</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><div class="date-cell"><span class="d">${escapeHtml(formatDate(s.date))}</span><span class="t">${escapeHtml(formatTime(s.createdAt))}</span></div></td>
      <td>${escapeHtml(s.agentName)}</td>
      <td>${escapeHtml(s.shopName)}</td>
      <td><span class="badge badge-${s.shift}">${escapeHtml(shiftLabel)}</span></td>
      <td>${loc}</td>
      <td style="color:var(--text-faint); font-size:12px;">${escapeHtml(s.submittedByName || s.submittedBy)}</td>
      <td>${isAdmin() ? `<button class="btn btn-ghost btn-sm delete-entry" data-id="${s.id}">Delete</button>` : ""}</td>
    `;
    body.appendChild(tr);
  });

  document.querySelectorAll(".delete-entry").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await deleteDoc(doc(db, "submissions", btn.dataset.id));
        state.submissions = state.submissions.filter(s => s.id !== btn.dataset.id);
        renderDashboard();
        showToast("Entry deleted.");
      } catch (e) {
        showToast("Couldn't delete that entry.");
      }
    });
  });

  const total = state.submissions.length;
  const withLocation = state.submissions.filter(s => s.location).length;
  const uniqueAgents = new Set(state.submissions.map(s => s.agentName.toLowerCase())).size;
  const todayCount = state.submissions.filter(s => s.date === todayStr()).length;
  $("statRow").innerHTML = `
    <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Total entries</div></div>
    <div class="stat-card"><div class="stat-num">${todayCount}</div><div class="stat-label">Logged today</div></div>
    <div class="stat-card"><div class="stat-num">${uniqueAgents}</div><div class="stat-label">Agents</div></div>
    <div class="stat-card"><div class="stat-num">${withLocation}</div><div class="stat-label">With GPS location</div></div>
  `;
}

// ---------- My Submissions (agent's own view) ----------
function renderMyDashboard() {
  const mine = state.submissions
    .filter(s => (s.submittedBy || "").toLowerCase() === (state.profile.email || "").toLowerCase())
    .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));

  const body = $("myDashboardBody");
  body.innerHTML = "";
  $("myDashboardEmpty").classList.toggle("hidden", mine.length > 0);

  mine.forEach(s => {
    const shiftLabel = s.shift === "Full" ? "Full day" : s.shift;
    const loc = s.location
      ? `<a class="loc-pill" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${s.location.lat},${s.location.lng}">📍 View map</a>`
      : `<span class="loc-none">No location</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><div class="date-cell"><span class="d">${escapeHtml(formatDate(s.date))}</span><span class="t">${escapeHtml(formatTime(s.createdAt))}</span></div></td>
      <td>${escapeHtml(s.shopName)}</td>
      <td><span class="badge badge-${s.shift}">${escapeHtml(shiftLabel)}</span></td>
      <td>${loc}</td>
    `;
    body.appendChild(tr);
  });

  const total = mine.length;
  const withLocation = mine.filter(s => s.location).length;
  const thisMonth = mine.filter(s => s.date && s.date.slice(0, 7) === todayStr().slice(0, 7)).length;
  $("myStatRow").innerHTML = `
    <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Total entries</div></div>
    <div class="stat-card"><div class="stat-num">${thisMonth}</div><div class="stat-label">This month</div></div>
    <div class="stat-card"><div class="stat-num">${withLocation}</div><div class="stat-label">With GPS location</div></div>
  `;
}

["filterFrom", "filterTo", "filterShop", "filterShift"].forEach(id => {
  $(id).addEventListener("change", renderDashboard);
});
$("clearFiltersBtn").addEventListener("click", () => {
  $("filterFrom").value = ""; $("filterTo").value = ""; $("filterShop").value = ""; $("filterShift").value = "";
  renderDashboard();
});
$("refreshBtn").addEventListener("click", async () => {
  await refreshSubmissions();
  renderDashboard();
  showToast("Refreshed.");
});
$("exportCsvBtn").addEventListener("click", () => {
  const rows = getFilteredSubmissions();
  if (rows.length === 0) { showToast("No entries to export."); return; }
  const header = ["Date", "Submitted At", "Agent Name", "Shop Name", "Shift", "Latitude", "Longitude", "Accuracy (m)", "Logged By"];
  const csvRows = [header.join(",")];
  rows.forEach(s => {
    const shiftLabel = s.shift === "Full" ? "Full day" : s.shift;
    const lat = s.location ? s.location.lat : "";
    const lng = s.location ? s.location.lng : "";
    const acc = s.location ? s.location.accuracy : "";
    const submittedAt = (s.createdAt && typeof s.createdAt.toDate === "function") ? s.createdAt.toDate().toLocaleString() : "";
    const line = [s.date, submittedAt, s.agentName, s.shopName, shiftLabel, lat, lng, acc, s.submittedByName || s.submittedBy]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
    csvRows.push(line);
  });
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `agent-locations-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- Schedule ----------
$("scheduleDate").addEventListener("change", renderSchedule);
$("scheduleShopFilter").addEventListener("change", renderSchedule);
$("scheduleShiftFilter").addEventListener("change", renderSchedule);

let lastScheduleReport = null; // cached data for the PDF export, refreshed on every render

function renderSchedule() {
  const date = $("scheduleDate").value || todayStr();
  const shopFilter = $("scheduleShopFilter").value;
  const shiftFilter = $("scheduleShiftFilter").value;

  const dayEntries = state.submissions.filter(s => s.date === date);
  const filteredEntries = dayEntries.filter(s => {
    if (shopFilter && s.shopName !== shopFilter) return false;
    if (shiftFilter && s.shift !== shiftFilter) return false;
    return true;
  });

  // Group the filtered entries by shop (day-off stays based on the full,
  // unfiltered day — being off doesn't depend on which shop you're looking at)
  const byShop = new Map();
  const shopsToShow = shopFilter ? state.shops.filter(s => s.name === shopFilter) : state.shops;
  shopsToShow.forEach(shop => byShop.set(shop.name, []));
  filteredEntries.forEach(s => {
    if (!byShop.has(s.shopName)) byShop.set(s.shopName, []);
    byShop.get(s.shopName).push(s);
  });

  // Who worked today, by email (most reliable identifier) — always based on
  // the full unfiltered day so "day off" means off entirely, not just off
  // for the currently filtered shop/shift.
  const workedEmails = new Set(dayEntries.map(s => (s.submittedBy || "").toLowerCase()));
  const offAgents = state.agents.filter(a => !workedEmails.has((a.email || "").toLowerCase()));

  const shopsWrap = $("scheduleShops");
  const shopNames = Array.from(byShop.keys()).sort((a, b) => a.localeCompare(b));
  if (shopNames.length === 0) {
    shopsWrap.innerHTML = `<div class="empty-state">No shops match this filter.</div>`;
  } else {
    shopsWrap.innerHTML = shopNames.map(shopName => {
      const entries = byShop.get(shopName);
      const chips = entries.length
        ? entries.map(e => {
            const shiftLabel = e.shift === "Full" ? "Full day" : e.shift;
            return `<div class="agent-chip">${escapeHtml(e.agentName)} <span class="badge badge-${e.shift}">${escapeHtml(shiftLabel)}</span></div>`;
          }).join("")
        : `<span class="loc-none">No agents scheduled</span>`;
      return `
        <div class="shop-card">
          <div class="shop-card-head">
            <span class="name">${escapeHtml(shopName)}</span>
            <span class="shop-count">${entries.length} agent${entries.length === 1 ? "" : "s"}</span>
          </div>
          <div class="agent-chips">${chips}</div>
        </div>
      `;
    }).join("");
  }

  const offWrap = $("scheduleOff");
  offWrap.innerHTML = offAgents.length
    ? `<div class="agent-chips">` + offAgents.map(a =>
        `<div class="agent-chip">${escapeHtml(a.name || a.email)} <span class="badge badge-Off">Day off</span></div>`
      ).join("") + `</div>`
    : `<div class="empty-state">Everyone on the roster has a shift logged for this day.</div>`;

  const shopsCovered = shopNames.filter(name => byShop.get(name).length > 0).length;
  $("scheduleStatRow").innerHTML = `
    <div class="stat-card"><div class="stat-num">${filteredEntries.length}</div><div class="stat-label">Shifts logged</div></div>
    <div class="stat-card"><div class="stat-num">${shopsCovered}</div><div class="stat-label">Shops covered</div></div>
    <div class="stat-card"><div class="stat-num">${offAgents.length}</div><div class="stat-label">Agents off</div></div>
  `;

  // Cache everything the PDF export needs so it always matches what's on screen.
  lastScheduleReport = { date, shopFilter, shiftFilter, byShop, shopNames, offAgents };
}

$("scheduleDownloadBtn").addEventListener("click", downloadScheduleReport);

function downloadScheduleReport() {
  if (!lastScheduleReport) return;
  if (!window.jspdf) { showToast("PDF library didn't load — check your connection and try again."); return; }
  const { jsPDF } = window.jspdf;
  const { date, shopFilter, shiftFilter, byShop, shopNames, offAgents } = lastScheduleReport;

  const docPdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = docPdf.internal.pageSize.getWidth();
  const margin = 40;

  // Header
  docPdf.setFillColor(15, 27, 45);
  docPdf.rect(0, 0, pageWidth, 70, "F");
  docPdf.setTextColor(255, 255, 255);
  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(16);
  docPdf.text("Agent Location Log — Schedule Report", margin, 32);
  docPdf.setFont("helvetica", "normal");
  docPdf.setFontSize(10);
  docPdf.setTextColor(220, 220, 220);
  docPdf.text(`Date: ${formatDate(date)}`, margin, 50);

  let filterLine = [];
  if (shopFilter) filterLine.push(`Shop: ${shopFilter}`);
  if (shiftFilter) filterLine.push(`Shift: ${shiftFilter === "Full" ? "Full day" : shiftFilter}`);
  filterLine.push(`Generated: ${new Date().toLocaleString()}`);
  docPdf.text(filterLine.join("   •   "), margin, 63);

  // Table rows: one per agent entry, grouped by shop
  const rows = [];
  shopNames.forEach(shopName => {
    const entries = byShop.get(shopName);
    if (entries.length === 0) {
      rows.push([shopName, "—", "—"]);
    } else {
      entries.forEach((e, i) => {
        const shiftLabel = e.shift === "Full" ? "Full day" : e.shift;
        rows.push([i === 0 ? shopName : "", e.agentName, shiftLabel]);
      });
    }
  });

  docPdf.autoTable({
    startY: 90,
    margin: { left: margin, right: margin },
    head: [["Shop", "Agent", "Shift"]],
    body: rows,
    theme: "grid",
    headStyles: { fillColor: [30, 51, 80], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 10, cellPadding: 6, textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [245, 247, 250] }
  });

  // Day off section
  let y = docPdf.lastAutoTable.finalY + 24;
  docPdf.setTextColor(30, 30, 30);
  docPdf.setFont("helvetica", "bold");
  docPdf.setFontSize(12);
  docPdf.text("Day off", margin, y);
  y += 6;

  if (offAgents.length === 0) {
    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(10);
    docPdf.text("Everyone on the roster has a shift logged for this day.", margin, y + 16);
  } else {
    docPdf.autoTable({
      startY: y + 10,
      margin: { left: margin, right: margin },
      head: [["Agent", "Status"]],
      body: offAgents.map(a => [a.name || a.email, "Day off"]),
      theme: "grid",
      headStyles: { fillColor: [30, 51, 80], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 10, cellPadding: 6, textColor: [30, 30, 30] },
      alternateRowStyles: { fillColor: [245, 247, 250] }
    });
  }

  // Footer with page numbers
  const pageCount = docPdf.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    docPdf.setPage(i);
    docPdf.setFontSize(8);
    docPdf.setTextColor(150, 150, 150);
    docPdf.text(`Page ${i} of ${pageCount}`, pageWidth - margin, docPdf.internal.pageSize.getHeight() - 20, { align: "right" });
  }

  const filenameParts = ["schedule", date];
  if (shopFilter) filenameParts.push(shopFilter.replace(/\s+/g, "-"));
  docPdf.save(filenameParts.join("_") + ".pdf");
}

// ---------- Shops management ----------
function renderShopsList() {
  const wrap = $("shopsList");
  if (state.shops.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No shops added yet.</div>`;
    return;
  }
  wrap.innerHTML = state.shops.map(shop => `
    <div class="list-row">
      <span class="name">${escapeHtml(shop.name)}</span>
      <button class="btn btn-danger btn-sm delete-shop" data-id="${shop.id}">Remove</button>
    </div>
  `).join("");
  document.querySelectorAll(".delete-shop").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await deleteDoc(doc(db, "shops", btn.dataset.id));
        await refreshShops();
        renderShopsList();
        populateShopSelects();
        showToast("Shop removed.");
      } catch (e) {
        showToast("Couldn't remove that shop.");
      }
    });
  });
}

$("addShopBtn").addEventListener("click", async () => {
  const name = $("newShopName").value.trim();
  if (!name) { showToast("Enter a shop name."); return; }
  if (state.shops.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    showToast("That shop already exists.");
    return;
  }
  try {
    await addDoc(collection(db, "shops"), { name });
    $("newShopName").value = "";
    await refreshShops();
    renderShopsList();
    populateShopSelects();
    showToast("Shop added.");
  } catch (e) {
    showToast("Couldn't add that shop.");
  }
});

// ---------- Users management ----------
async function refreshUsersList() {
  const snap = await getDocs(collection(db, "users"));
  state.allUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  renderUsersList();
}

function renderUsersList() {
  const search = $("userSearch").value.trim().toLowerCase();
  const roleFilter = $("userRoleFilter").value;
  const users = state.allUsers.filter(u => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (search) {
      const hay = `${u.name || ""} ${u.email || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const wrap = $("usersList");
  if (state.allUsers.length === 0) { wrap.innerHTML = `<div class="empty-state">No users yet.</div>`; return; }
  if (users.length === 0) { wrap.innerHTML = `<div class="empty-state">No users match this filter.</div>`; return; }
  wrap.innerHTML = users.map(u => `
    <div class="list-row">
      <div>
        <div class="name">${escapeHtml(u.name || u.email)} <span class="role-tag">${u.role.toUpperCase()}</span></div>
        <div class="meta">${escapeHtml(u.email)}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-teal btn-sm reset-pw" data-email="${escapeHtml(u.email)}">Send reset email</button>
        ${ADMIN_EMAILS_LC.includes(u.email.toLowerCase()) ? "" : `<button class="btn btn-danger btn-sm revoke-user" data-uid="${u.uid}">Revoke access</button>`}
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".revoke-user").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await deleteDoc(doc(db, "users", btn.dataset.uid));
        await refreshUsersList();
        showToast("Access revoked. (Their sign-in credentials still exist in Firebase Auth — remove them there too if needed.)");
      } catch (e) {
        showToast("Couldn't revoke access.");
      }
    });
  });
  document.querySelectorAll(".reset-pw").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await sendPasswordResetEmail(auth, btn.dataset.email);
        showToast("Reset email sent.");
      } catch (e) {
        showToast(friendlyAuthError(e));
      }
    });
  });
}

$("userSearch").addEventListener("input", renderUsersList);
$("userRoleFilter").addEventListener("change", renderUsersList);

$("addUserBtn").addEventListener("click", async () => {
  const name = $("newUserName").value.trim();
  const email = $("newUserEmail").value.trim().toLowerCase();
  const role = $("newUserRole").value;
  const password = $("newUserPassword").value;
  if (!name || !email || !password) { showToast("Fill in name, email, and password."); return; }
  if (password.length < 6) { showToast("Password must be at least 6 characters."); return; }

  $("addUserBtn").disabled = true;
  try {
    // Create the Auth account on the secondary app instance so the admin's
    // own session on the primary app is not disturbed.
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = cred.user.uid;
    await signOut(secondaryAuth);
    // Write the profile using the primary (admin-authenticated) Firestore connection.
    await setDoc(doc(db, "users", newUid), { email, name, role });
    $("newUserName").value = ""; $("newUserEmail").value = ""; $("newUserPassword").value = "";
    await refreshUsersList();
    showToast("User added.");
  } catch (e) {
    showToast(friendlyAuthError(e));
  } finally {
    $("addUserBtn").disabled = false;
  }
});

// ---------- Account ----------
$("accountResetBtn").addEventListener("click", async () => {
  try {
    await sendPasswordResetEmail(auth, state.profile.email);
    $("accountMsg").classList.remove("hidden");
    setTimeout(() => $("accountMsg").classList.add("hidden"), 3000);
  } catch (e) {
    showToast(friendlyAuthError(e));
  }
});
