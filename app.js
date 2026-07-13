import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
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
function isManager() { return state.profile && state.profile.role === "manager"; }

// Shops a Shop Manager is scoped to. Returns null for admins/agents (no restriction).
function getVisibleShopNames() {
  if (isManager()) return new Set(state.profile.managedShops || []);
  return null;
}

// The base set of submissions a user is allowed to see in Dashboard/Schedule —
// everything for admins, only their assigned shops for managers.
function getScopedSubmissions() {
  const visible = getVisibleShopNames();
  if (!visible) return state.submissions;
  return state.submissions.filter(s => visible.has(s.shopName));
}

async function enterApp() {
  $("setupScreen").classList.add("hidden");
  $("loginScreen").classList.add("hidden");
  $("mainApp").classList.remove("hidden");
  $("currentUserName").textContent = state.profile.name || state.profile.email;
  $("currentUserRole").textContent = state.profile.role.toUpperCase();
  $("fAgent").value = state.profile.name || "";
  $("fDate").value = todayStr();

  ["navDashboard", "navSchedule"].forEach(id => $(id).classList.toggle("hidden", !(isAdmin() || isManager())));
  ["navShops", "navUsers"].forEach(id => $(id).classList.toggle("hidden", !isAdmin()));

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
  if (page === "mysubmissions") { await Promise.all([refreshSubmissions(), refreshShops()]); renderMyDashboard(); }
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
  $("fShop").innerHTML = state.shops.length
    ? `<option value="" selected disabled>Select your shop</option>` + opts
    : `<option value="">No shops yet</option>`;

  const visible = getVisibleShopNames();
  const filterShops = visible ? state.shops.filter(s => visible.has(s.name)) : state.shops;
  const filterOpts = filterShops.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
  $("filterShop").innerHTML = `<option value="">All shops</option>` + filterOpts;
}

function populateScheduleShopFilter() {
  const visible = getVisibleShopNames();
  const shops = visible ? state.shops.filter(s => visible.has(s.name)) : state.shops;
  const opts = shops.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
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
  statusEl.textContent = "Checking today's entries…";

  try {
    const existingSnap = await getDocs(query(
      collection(db, "submissions"),
      where("submittedBy", "==", state.profile.email),
      where("date", "==", date)
    ));
    const existingShifts = existingSnap.docs.map(d => d.data().shift);
    const isDuplicate = shift === "Full"
      ? existingShifts.length > 0
      : existingShifts.includes(shift) || existingShifts.includes("Full");

    if (isDuplicate) {
      statusEl.className = "loc-status err";
      statusEl.textContent = "You've already logged a shift for this date. Edit it from \"My Submissions\" instead of adding another.";
      showToast("You've already submitted a shift for this date.");
      $("submitFormBtn").disabled = false;
      return;
    }
  } catch (e) {
    console.error(e);
    statusEl.className = "loc-status err";
    statusEl.textContent = "Couldn't verify today's entries — check your connection and try again.";
    $("submitFormBtn").disabled = false;
    return;
  }

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
  return getScopedSubmissions().filter(s => {
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

  const scoped = getScopedSubmissions();
  const total = scoped.length;
  const withLocation = scoped.filter(s => s.location).length;
  const uniqueAgents = new Set(scoped.map(s => s.agentName.toLowerCase())).size;
  const todayCount = scoped.filter(s => s.date === todayStr()).length;
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
      <td><button class="btn btn-ghost btn-sm edit-my-shop" data-id="${s.id}" data-shop="${escapeHtml(s.shopName)}">Edit shop</button></td>
    `;
    body.appendChild(tr);
  });

  document.querySelectorAll(".edit-my-shop").forEach(btn => {
    btn.addEventListener("click", () => openEditShopModal(btn.dataset.id, btn.dataset.shop));
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

function openEditShopModal(submissionId, currentShop) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  const opts = state.shops.map(s =>
    `<option value="${escapeHtml(s.name)}" ${s.name === currentShop ? "selected" : ""}>${escapeHtml(s.name)}</option>`
  ).join("");
  bg.innerHTML = `
    <div class="modal">
      <h3>Fix shop</h3>
      <p style="font-size:13px; color:var(--text-dim); margin-top:-8px;">Picked the wrong shop by mistake? Correct it here.</p>
      <div class="field">
        <label>Shop</label>
        <select id="editShopSelect">${opts}</select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="editShopCancel">Cancel</button>
        <button class="btn btn-primary" id="editShopSave">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  bg.querySelector("#editShopCancel").addEventListener("click", () => bg.remove());
  bg.querySelector("#editShopSave").addEventListener("click", async () => {
    const newShop = bg.querySelector("#editShopSelect").value;
    if (!newShop) { bg.remove(); return; }
    try {
      await updateDoc(doc(db, "submissions", submissionId), { shopName: newShop });
      const s = state.submissions.find(x => x.id === submissionId);
      if (s) s.shopName = newShop;
      renderMyDashboard();
      showToast("Shop updated.");
    } catch (e) {
      console.error(e);
      showToast("Couldn't update — you can only edit your own recent entries.");
    }
    bg.remove();
  });
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

function renderSchedule() {
  const date = $("scheduleDate").value || todayStr();
  const shopFilter = $("scheduleShopFilter").value;
  const shiftFilter = $("scheduleShiftFilter").value;
  const visible = getVisibleShopNames();

  const scoped = getScopedSubmissions();
  const dayEntries = scoped.filter(s => s.date === date);
  const filteredEntries = dayEntries.filter(s => {
    if (shopFilter && s.shopName !== shopFilter) return false;
    if (shiftFilter && s.shift !== shiftFilter) return false;
    return true;
  });

  // Group the filtered entries by shop (day-off stays based on the full,
  // unfiltered day — being off doesn't depend on which shop you're looking at)
  const byShop = new Map();
  let shopsToShow = shopFilter ? state.shops.filter(s => s.name === shopFilter) : state.shops;
  if (visible) shopsToShow = shopsToShow.filter(s => visible.has(s.name));
  shopsToShow.forEach(shop => byShop.set(shop.name, []));
  filteredEntries.forEach(s => {
    if (!byShop.has(s.shopName)) byShop.set(s.shopName, []);
    byShop.get(s.shopName).push(s);
  });

  // Who worked today, by email (most reliable identifier) — always based on
  // the full unfiltered day so "day off" means off entirely, not just off
  // for the currently filtered shop/shift.
  const workedEmails = new Set(dayEntries.map(s => (s.submittedBy || "").toLowerCase()));
  let relevantAgents = state.agents;
  if (visible) {
    const everWorkedTheseShops = new Set(scoped.map(s => (s.submittedBy || "").toLowerCase()));
    relevantAgents = state.agents.filter(a => everWorkedTheseShops.has((a.email || "").toLowerCase()));
  }
  const offAgents = relevantAgents.filter(a => !workedEmails.has((a.email || "").toLowerCase()));

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
}

$("scheduleDownloadBtn").addEventListener("click", downloadScheduleImage);

// Builds the data set for the image export. Unlike the on-screen view, when
// filtering by AM or PM this also includes Full-day agents (they're working
// that half of the day too), and it never includes the Day-off list.
function buildScheduleExportData() {
  const date = $("scheduleDate").value || todayStr();
  const shopFilter = $("scheduleShopFilter").value;
  const shiftFilter = $("scheduleShiftFilter").value;
  const visible = getVisibleShopNames();

  const scoped = getScopedSubmissions();
  const dayEntries = scoped.filter(s => s.date === date);

  const matchesShift = (s) => {
    if (!shiftFilter) return true;
    if (shiftFilter === "AM" || shiftFilter === "PM") return s.shift === shiftFilter || s.shift === "Full";
    return s.shift === shiftFilter; // "Full" filter: exact match only
  };

  const filteredEntries = dayEntries.filter(s => {
    if (shopFilter && s.shopName !== shopFilter) return false;
    if (!matchesShift(s)) return false;
    return true;
  });

  const byShop = new Map();
  let shopsToShow = shopFilter ? state.shops.filter(s => s.name === shopFilter) : state.shops;
  if (visible) shopsToShow = shopsToShow.filter(s => visible.has(s.name));
  shopsToShow.forEach(shop => byShop.set(shop.name, []));
  filteredEntries.forEach(s => {
    if (!byShop.has(s.shopName)) byShop.set(s.shopName, []);
    byShop.get(s.shopName).push(s);
  });

  const shopNames = Array.from(byShop.keys()).sort((a, b) => a.localeCompare(b));
  return { date, shopFilter, shiftFilter, byShop, shopNames };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function downloadScheduleImage() {
  const { date, shopFilter, shiftFilter, byShop, shopNames } = buildScheduleExportData();

  const FONT = "-apple-system, 'Segoe UI', Arial, sans-serif";
  const width = 800;
  const margin = 28;
  const headerHeight = 96;
  const lineHeight = 26;
  const shopHeaderHeight = 30;
  const shopGap = 14;
  const blockPadding = 12;
  const footerHeight = 34;

  const shopHeights = shopNames.map(name => {
    const rows = Math.max(byShop.get(name).length, 1);
    return shopHeaderHeight + rows * lineHeight + blockPadding * 2;
  });
  const contentHeight = shopNames.length === 0
    ? 50
    : shopHeights.reduce((a, b) => a + b, 0) + shopGap * (shopNames.length - 1);

  const totalHeight = headerHeight + margin + contentHeight + margin + footerHeight;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = totalHeight * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = "#0F1B2D";
  ctx.fillRect(0, 0, width, totalHeight);

  // Header
  ctx.fillStyle = "#F2A93B";
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillText("Agent Schedule", margin, 38);
  ctx.fillStyle = "#EAF0F8";
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText(formatDate(date), margin, 62);

  const filterParts = [];
  if (shopFilter) filterParts.push(`Shop: ${shopFilter}`);
  if (shiftFilter) {
    const label = shiftFilter === "Full" ? "Full day" : shiftFilter;
    filterParts.push(`Shift: ${label}${shiftFilter !== "Full" ? " (incl. Full day)" : ""}`);
  }
  ctx.fillStyle = "#93A5C2";
  ctx.font = `12px ${FONT}`;
  ctx.fillText(filterParts.length ? filterParts.join("   •   ") : "All shops • All shifts", margin, 82);

  // Body
  let y = headerHeight + margin;
  const chipColors = {
    AM: { border: "#7a5a1e", text: "#ffd27a" },
    PM: { border: "#215079", text: "#8fd0ff" },
    Full: { border: "#1e6a3f", text: "#9be8b9" }
  };

  if (shopNames.length === 0) {
    ctx.fillStyle = "#5F7593";
    ctx.font = `14px ${FONT}`;
    ctx.fillText("No shops match this filter.", margin, y + 18);
  } else {
    shopNames.forEach((name, i) => {
      const entries = byShop.get(name);
      const h = shopHeights[i];

      ctx.fillStyle = "#1E3350";
      roundRectPath(ctx, margin, y, width - margin * 2, h, 8);
      ctx.fill();

      ctx.fillStyle = "#EAF0F8";
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillText(name, margin + 16, y + 22);

      const countText = `${entries.length} agent${entries.length === 1 ? "" : "s"}`;
      ctx.font = `bold 11px ${FONT}`;
      const countWidth = ctx.measureText(countText).width;
      ctx.fillStyle = "#F2A93B";
      ctx.fillText(countText, width - margin - 16 - countWidth, y + 21);

      let ly = y + shopHeaderHeight + blockPadding;
      if (entries.length === 0) {
        ctx.fillStyle = "#5F7593";
        ctx.font = `13px ${FONT}`;
        ctx.fillText("No agents scheduled", margin + 16, ly + 13);
      } else {
        entries.forEach(e => {
          const shiftLabel = e.shift === "Full" ? "Full day" : e.shift;
          ctx.fillStyle = "#EAF0F8";
          ctx.font = `13px ${FONT}`;
          ctx.fillText(e.agentName, margin + 16, ly + 13);
          const nameWidth = ctx.measureText(e.agentName).width;

          const submittedAt = formatTime(e.createdAt);
          if (submittedAt && submittedAt !== "—") {
            ctx.fillStyle = "#5F7593";
            ctx.font = `11px ${FONT}`;
            ctx.fillText(submittedAt, margin + 16 + nameWidth + 10, ly + 13);
          }

          ctx.font = `bold 10px ${FONT}`;
          const chipText = shiftLabel.toUpperCase();
          const chipTextWidth = ctx.measureText(chipText).width;
          const chipW = chipTextWidth + 18;
          const chipX = width - margin - 16 - chipW;
          const colors = chipColors[e.shift] || { border: "#2A4363", text: "#93A5C2" };

          ctx.strokeStyle = colors.border;
          ctx.lineWidth = 1;
          roundRectPath(ctx, chipX, ly - 1, chipW, 18, 9);
          ctx.stroke();
          ctx.fillStyle = colors.text;
          ctx.fillText(chipText, chipX + 9, ly + 12);

          ly += lineHeight;
        });
      }
      y += h + shopGap;
    });
  }

  // Footer
  ctx.fillStyle = "#5F7593";
  ctx.font = `11px ${FONT}`;
  ctx.fillText(`Generated ${new Date().toLocaleString()}`, margin, totalHeight - 14);

  canvas.toBlob(blob => {
    if (!blob) { showToast("Couldn't generate the image — please try again."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const parts = ["schedule", date];
    if (shopFilter) parts.push(shopFilter.replace(/\s+/g, "-"));
    if (shiftFilter) parts.push(shiftFilter);
    a.href = url;
    a.download = parts.join("_") + ".jpg";
    a.click();
    URL.revokeObjectURL(url);
  }, "image/jpeg", 0.92);
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
        ${u.role === "manager" && (u.managedShops || []).length ? `<div class="meta">Manages: ${escapeHtml(u.managedShops.join(", "))}</div>` : ""}
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

function populateManagedShopsCheckboxes() {
  const wrap = $("managedShopsCheckboxes");
  if (state.shops.length === 0) {
    wrap.innerHTML = `<span class="loc-none">No shops configured yet — add one on the Shops tab first.</span>`;
    return;
  }
  wrap.innerHTML = state.shops.map(s => `
    <label class="shop-checkbox-item">
      <input type="checkbox" value="${escapeHtml(s.name)}"> ${escapeHtml(s.name)}
    </label>
  `).join("");
}

$("newUserRole").addEventListener("change", () => {
  const isMgr = $("newUserRole").value === "manager";
  $("managedShopsField").classList.toggle("hidden", !isMgr);
  if (isMgr) populateManagedShopsCheckboxes();
});

$("addUserBtn").addEventListener("click", async () => {
  const name = $("newUserName").value.trim();
  const email = $("newUserEmail").value.trim().toLowerCase();
  const role = $("newUserRole").value;
  const password = $("newUserPassword").value;
  if (!name || !email || !password) { showToast("Fill in name, email, and password."); return; }
  if (password.length < 6) { showToast("Password must be at least 6 characters."); return; }

  let managedShops = [];
  if (role === "manager") {
    managedShops = Array.from($("managedShopsCheckboxes").querySelectorAll("input:checked")).map(el => el.value);
    if (managedShops.length === 0) { showToast("Select at least one shop for this manager."); return; }
  }

  $("addUserBtn").disabled = true;
  try {
    // Create the Auth account on the secondary app instance so the admin's
    // own session on the primary app is not disturbed.
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = cred.user.uid;
    await signOut(secondaryAuth);
    // Write the profile using the primary (admin-authenticated) Firestore connection.
    const profileDoc = { email, name, role };
    if (role === "manager") profileDoc.managedShops = managedShops;
    await setDoc(doc(db, "users", newUid), profileDoc);
    $("newUserName").value = ""; $("newUserEmail").value = ""; $("newUserPassword").value = "";
    $("newUserRole").value = "agent";
    $("managedShopsField").classList.add("hidden");
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
