(function(){
"use strict";
const CFG = window.OLAX_CONFIG || {};
const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const naira = n => (n < 0 ? "-" : "") + "₦" + Math.round(Math.abs(n)).toLocaleString("en-NG");
const kgf = n => (Math.round(n * 10) / 10).toLocaleString("en-NG") + " kg";
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => ymd(new Date());
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const fmtDate = id => { const [, m, d] = id.split("-"); return +d + " " + MONTHS[+m - 1].slice(0, 3); };
const emailFor = u => { u = u.trim().toLowerCase(); return u.includes("@") ? u : u + "@" + (CFG.EMAIL_DOMAIN || "olaxgas.app"); };

document.querySelectorAll("[data-logo]").forEach(el => el.prepend($("logoTpl").content.cloneNode(true)));

if (!window.supabase || !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("YOUR-PROJECT")) {
  $("l-err").textContent = "The app isn't connected to its database yet. Fill in config.js (see README).";
  $("l-btn").disabled = true;
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

let me = null;               // { id, username, full_name, role }
let settings = { price_per_kg: 0, cost_per_kg: 0, salary: 0, reinvest_pct: 50, partner_a: "Partner 1", partner_b: "Partner 2" };
let days = {};               // day -> row (recent + current month)
let monthRows = [], monthExp = [], users = [];
let dirty = false, confirmZero = false, lastReport = "";
const isPartner = () => me && (me.role === "partner" || me.role === "owner");
const isOwner = () => me && me.role === "owner";

/* ---------------- auth ---------------- */
$("loginForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const u = $("l-user").value, p = $("l-pass").value;
  if (!u.trim() || !p) { $("l-err").textContent = "Enter your username and password."; return; }
  $("l-btn").disabled = true; $("l-err").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: emailFor(u), password: p });
  $("l-btn").disabled = false;
  if (error) { $("l-err").textContent = "Wrong username or password."; return; }
  $("l-pass").value = "";
  await start();
});
$("logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); showLogin(); });

const isFakeEmail = e => e.endsWith("@" + (CFG.EMAIL_DOMAIN || "olaxgas.app"));
$("forgotBtn").addEventListener("click", () => {
  const u = $("l-user").value.trim();
  $("forgotBox").hidden = false;
  if (u.includes("@") && !isFakeEmail(u.toLowerCase())) {
    $("forgotMsg").textContent = "We can email a reset link to " + u + ".";
    $("forgotEmailRow").hidden = false;
  } else {
    $("forgotMsg").textContent = "Ask the shop owner to reset your password. They can set a new one for you from the Users page. (If you log in with an email address, type it above and press Forgot password again.)";
    $("forgotEmailRow").hidden = true;
  }
});
$("forgotSend").addEventListener("click", async () => {
  const email = $("l-user").value.trim().toLowerCase();
  $("forgotSend").disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $("forgotSend").disabled = false;
  $("forgotMsg").textContent = error ? "Couldn't send the email: " + error.message : "Check your inbox for the reset link, then open it on this device.";
  if (!error) $("forgotEmailRow").hidden = true;
});
function showReset() {
  $("app").hidden = true; $("loginScreen").hidden = false;
  $("loginForm").hidden = true; $("resetForm").hidden = false;
}
$("resetForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const a = $("n-pass").value, b = $("n-pass2").value;
  if (a.length < 6) { $("n-err").textContent = "Use at least 6 characters."; return; }
  if (a !== b) { $("n-err").textContent = "The two passwords don't match."; return; }
  $("n-btn").disabled = true;
  const { error } = await sb.auth.updateUser({ password: a });
  $("n-btn").disabled = false;
  if (error) { $("n-err").textContent = "Couldn't save: " + error.message; return; }
  $("resetForm").hidden = true; $("loginForm").hidden = false; $("n-pass").value = $("n-pass2").value = "";
  history.replaceState(null, "", location.pathname);
  await start();
});

function showLogin(msg) {
  me = null; $("resetForm").hidden = true; $("loginForm").hidden = false; $("app").hidden = true; $("loginScreen").hidden = false;
  $("l-err").textContent = msg || ""; history.replaceState(null, "", location.pathname);
}

async function start() {
  if (recovering || /type=recovery/.test(location.hash)) { recovering = true; return showReset(); }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: prof, error: pErr } = await sb.from("profiles").select("id,username,full_name,role,active").eq("id", session.user.id).maybeSingle();
  if (pErr) { await sb.auth.signOut(); return showLogin("Couldn't load your account. Check your internet and try again."); }
  if (!prof || !prof.active) { await sb.auth.signOut(); return showLogin("This account is turned off or not set up yet."); }
  me = prof;
  $("loginScreen").hidden = true; $("app").hidden = false;
  document.querySelectorAll("[data-partner]").forEach(a => a.hidden = !isPartner());
  document.querySelectorAll("[data-owner]").forEach(a => a.hidden = !isOwner());
  $("tabs").hidden = !isPartner();
  $("whoChip").textContent = ({ owner: "Owner", partner: "Partner", salesman: "Salesman" }[me.role]) + " · " + me.full_name;
  $("d-price").readOnly = !isPartner();
  $("d-date").value = today(); $("m-month").value = today().slice(0, 7); $("e-date").value = today();
  await loadSettings();
  await loadRecent();
  fillForm(today());
  route();
}

/* ---------------- data ---------------- */
function banner(msg) { const b = $("banner"); b.hidden = !msg; b.textContent = msg || ""; }
async function loadSettings() {
  const { data, error } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error) banner("Couldn't load settings. Check your internet.");
  if (data) settings = data;
  fillSettings();
}
async function loadRecent() {
  const from = new Date(); from.setDate(from.getDate() - 14);
  const { data, error } = await sb.from("days").select("*").gte("day", ymd(from)).order("day", { ascending: false });
  if (error) { banner("Couldn't load recent days. Check your internet."); return; }
  banner("");
  data.forEach(r => days[r.day] = r);
  renderRecent();
}

/* ---------------- daily ---------------- */
function calc(e) {
  const kg = num(e.kg), price = num(e.price), cost = num(e.cost ?? settings.cost_per_kg);
  const gasSales = kg * price, acc = num(e.acc), total = gasSales + acc, received = num(e.cash) + num(e.transfer);
  return { kg, price, cost, gasSales, acc, total, received, diff: received - total, cogs: kg * cost, opened: kg > 0 || acc > 0 };
}
function cashPill(c) {
  if (c.received === 0) return '<span class="pill over">Not entered</span>';
  if (Math.abs(c.diff) < 1) return '<span class="pill ok">Balanced</span>';
  return c.diff < 0 ? '<span class="pill short">Short ' + naira(-c.diff) + '</span>' : '<span class="pill over">Over ' + naira(c.diff) + '</span>';
}
const row = (a, b, big) => '<div' + (big ? ' class="big"' : '') + '><span>' + a + '</span><span>' + b + '</span></div>';
const tile = (a, b, cls) => '<div class="tile' + (cls ? " " + cls : "") + '"><span>' + a + '</span><strong>' + b + '</strong></div>';

const F = ["kg", "price", "acc", "cash", "transfer", "notes", "seller"];
function readForm() { const e = {}; F.forEach(k => e[k] = $("d-" + k).value); return e; }
async function fillForm(id) {
  if (!days[id] && isPartner()) {
    const { data } = await sb.from("days").select("*").eq("day", id).maybeSingle();
    if (data) days[id] = data;
  }
  const e = days[id];
  F.forEach(k => { $("d-" + k).value = e ? (e[k] ?? "") : ""; });
  if (!e) { $("d-price").value = settings.price_per_kg; $("d-seller").value = me.role === "salesman" ? me.full_name : ""; }
  dirty = false; updateDay();
}
function updateDay() {
  const c = calc(readForm());
  $("daySum").innerHTML =
    row("Gas sales (" + kgf(c.kg) + " × " + naira(c.price) + ")", naira(c.gasSales)) +
    row("Accessories", naira(c.acc)) + row("Total sales", naira(c.total), true) +
    row("Money received (cash + transfer)", naira(c.received)) + row("Cash check", cashPill(c));
  $("dayExpected").textContent = naira(c.total);
}
function renderRecent() {
  const ids = Object.keys(days).sort().reverse().slice(0, 14);
  $("recent").querySelector("tbody").innerHTML = ids.map(id => {
    const c = calc(days[id]);
    return '<tr><td>' + fmtDate(id) + '</td><td>' + kgf(c.kg) + '</td><td>' + naira(c.total) + '</td><td>' + cashPill(c) + '</td></tr>';
  }).join("");
  $("recentEmpty").hidden = ids.length > 0;
}
$("dayForm").addEventListener("input", e => {
  if (e.target.id === "d-date") fillForm(e.target.value);
  else { dirty = true; confirmZero = false; updateDay(); }
});
$("dayForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const id = $("d-date").value; if (!id) { $("saveStatus").textContent = "Pick a date first."; return; }
  const e = readForm();
  const rec = { day: id, seller: e.seller.trim(), notes: e.notes.trim() };
  ["kg", "price", "acc", "cash", "transfer"].forEach(k => rec[k] = num(e[k]));
  if (rec.kg <= 0 && rec.acc <= 0 && !confirmZero) { confirmZero = true; $("saveStatus").textContent = "No sales entered. Press Save again to record a closed day."; return; }
  confirmZero = false;
  $("saveBtn").disabled = true; $("saveStatus").textContent = "Saving…";
  const { data, error } = await sb.from("days").upsert(rec, { onConflict: "day" }).select().maybeSingle();
  $("saveBtn").disabled = false;
  if (error) {
    $("saveStatus").textContent = me.role === "salesman"
      ? "Couldn't save. You can only save today or the 2 days before. Check your internet."
      : "Couldn't save: " + error.message;
    return;
  }
  if (data) days[id] = data;
  dirty = false; $("saveStatus").textContent = "Saved for " + fmtDate(id) + ".";
  fillForm(id); renderRecent();
});

/* ---------------- monthly ---------------- */
async function loadMonth() {
  const ym = $("m-month").value || today().slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const first = ym + "-01", last = ymd(new Date(y, m, 0));
  const [d, x] = await Promise.all([
    sb.from("days").select("*").gte("day", first).lte("day", last).order("day"),
    sb.from("expenses").select("*").gte("date", first).lte("date", last).order("date")
  ]);
  if (d.error || x.error) { banner("Couldn't load this month. Check your internet."); return; }
  banner("");
  monthRows = d.data; monthExp = x.data;
  renderMonth(ym);
}
function renderMonth(ym) {
  const [y, m] = ym.split("-");
  $("monthTitle").textContent = MONTHS[+m - 1] + " " + y;
  const t = { kg: 0, gasSales: 0, acc: 0, total: 0, cogs: 0, short: 0, over: 0, open: 0 };
  const rows = monthRows.map(e => {
    const c = calc(e);
    t.kg += c.kg; t.gasSales += c.gasSales; t.acc += c.acc; t.total += c.total; t.cogs += c.cogs;
    if (c.received > 0) { if (c.diff < -.5) t.short += -c.diff; else if (c.diff > .5) t.over += c.diff; }
    if (c.opened) t.open++;
    return { e, c };
  });
  const expTotal = monthExp.reduce((s, x) => s + num(x.amount), 0);
  const salary = t.open > 0 ? num(settings.salary) : 0;
  const net = t.total - t.cogs - salary - expTotal;
  const rp = Math.min(100, Math.max(0, num(settings.reinvest_pct)));
  const reinvest = net > 0 ? net * rp / 100 : 0, share = net - reinvest, each = share / 2;

  $("mTiles").innerHTML = tile("Total sales", naira(t.total)) + tile("Gas sold", kgf(t.kg)) + tile("Salary + expenses", naira(expTotal + salary)) + tile("Net profit", naira(net), "profit");
  const dim = new Date(+y, +m, 0).getDate();
  const byDay = Array(dim).fill(0); rows.forEach(({ e, c }) => byDay[+e.day.slice(8) - 1] = c.total);
  $("mChart").innerHTML = barChart(byDay);

  const L = (a, b, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + a + '</td><td>' + b + '</td></tr>';
  $("mPL").querySelector("tbody").innerHTML =
    L("Gas sales", naira(t.gasSales)) + L("Accessories sales", naira(t.acc)) + L("Total sales", naira(t.total), "total") +
    L("Less cost of gas sold (" + kgf(t.kg) + ")", naira(-t.cogs)) + L("Less salesman salary", naira(-salary)) + L("Less expenses", naira(-expTotal)) +
    L("Net profit", naira(net), "total") + L("Kept for restocking (" + rp + "%)", naira(-reinvest)) + L("Profit to share", naira(share), "total");
  $("mSplit").innerHTML = tile(esc(settings.partner_a) + " (50%)", naira(each)) + tile(esc(settings.partner_b) + " (50%)", naira(each));

  $("mExp").querySelector("tbody").innerHTML = monthExp.map(x =>
    '<tr><td>' + fmtDate(x.date) + '</td><td class="text">' + esc(x.category) + '</td><td class="text">' + esc(x.description) + '</td><td class="text">' + esc(x.paid_by) +
    '</td><td>' + naira(num(x.amount)) + '</td><td><button class="danger small" type="button" data-delexp="' + x.id + '">Remove</button></td></tr>').join("") +
    (monthExp.length ? '<tr class="total"><td>Total</td><td></td><td></td><td></td><td>' + naira(expTotal) + '</td><td></td></tr>' : '');
  $("mExpEmpty").hidden = monthExp.length > 0;

  const sellers = [...new Set(monthRows.map(r => (r.seller || "").trim()).filter(Boolean))];
  $("mSeller").innerHTML = row("Name", esc(sellers.join(", ") || "Not entered")) + row("Days open", t.open) + row("Gas sold", kgf(t.kg)) +
    row("Salary this month", naira(salary), true) +
    row("Cash short", t.short > 0 ? '<span class="pill short">' + naira(t.short) + '</span>' : '<span class="pill ok">₦0</span>') + row("Cash over", naira(t.over));

  $("mDays").querySelector("tbody").innerHTML = rows.map(({ e, c }) =>
    '<tr><td>' + fmtDate(e.day) + '</td><td>' + kgf(c.kg) + '</td><td>' + naira(c.gasSales) + '</td><td>' + naira(c.acc) + '</td><td>' + naira(c.total) + '</td><td>' + cashPill(c) + '</td></tr>').join("") +
    (rows.length ? '<tr class="total"><td>Total</td><td>' + kgf(t.kg) + '</td><td>' + naira(t.gasSales) + '</td><td>' + naira(t.acc) + '</td><td>' + naira(t.total) + '</td><td></td></tr>' : '');
  $("mEmpty").hidden = rows.length > 0;

  lastReport = ["OLAX GAS — " + MONTHS[+m - 1].toUpperCase() + " " + y, "Days open: " + t.open, "Gas sold: " + kgf(t.kg),
    "Total sales: " + naira(t.total), "Cost of gas: " + naira(t.cogs), "Salesman salary: " + naira(salary), "Expenses: " + naira(expTotal),
    "Net profit: " + naira(net), "Kept for restock (" + rp + "%): " + naira(reinvest), "To share: " + naira(share),
    settings.partner_a + ": " + naira(each), settings.partner_b + ": " + naira(each), "Cash short: " + naira(t.short)].join("\n");
}
function barChart(vals) {
  const W = 700, H = 220, pl = 56, pb = 24, pt = 10, pr = 8, max = Math.max(...vals, 0);
  const step = niceStep(max), top = Math.max(step * Math.ceil(max / step), step), bw = (W - pl - pr) / vals.length;
  let g = "";
  for (let v = 0; v <= top + .1; v += step) {
    const yy = pt + (H - pt - pb) * (1 - v / top);
    g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--line)"/><text x="' + (pl - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + (v >= 1000 ? (v / 1000).toLocaleString("en-NG") + "k" : v) + '</text>';
  }
  const best = vals.indexOf(max);
  vals.forEach((v, i) => {
    const h = (H - pt - pb) * (v / top), x = pl + i * bw + bw * .15;
    if (v > 0) g += '<rect x="' + x.toFixed(1) + '" y="' + (H - pb - h).toFixed(1) + '" width="' + (bw * .7).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + (i === best ? "var(--flame)" : "var(--accent)") + '"><title>Day ' + (i + 1) + ': ' + naira(v) + '</title></rect>';
    if ((i + 1) % 5 === 0 || i === 0) g += '<text x="' + (pl + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + (i + 1) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily sales for the month">' + g + '</svg>' +
    (max > 0 ? '<p class="note">Best day: ' + (best + 1) + ', ' + naira(max) + ' (orange).</p>' : '<p class="empty">No sales to chart yet.</p>');
}
function niceStep(max) { if (max <= 0) return 10000; const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

$("m-month").addEventListener("input", loadMonth);
$("expForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const x = { date: $("e-date").value || today(), amount: num($("e-amount").value), category: $("e-cat").value, paid_by: $("e-by").value, description: $("e-desc").value.trim() };
  if (x.amount <= 0) { $("e-status").textContent = "Enter an amount."; return; }
  $("e-add").disabled = true; $("e-status").textContent = "Saving…";
  const { error } = await sb.from("expenses").insert(x);
  $("e-add").disabled = false;
  if (error) { $("e-status").textContent = "Couldn't save the expense. Try again."; return; }
  $("e-amount").value = ""; $("e-desc").value = ""; $("e-status").textContent = "Expense added.";
  loadMonth();
});
$("mExp").addEventListener("click", async e => {
  const id = e.target.dataset && e.target.dataset.delexp; if (!id) return;
  const { error } = await sb.from("expenses").delete().eq("id", id);
  if (error) $("e-status").textContent = "Couldn't remove it. Try again."; else loadMonth();
});
$("copyBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(lastReport); $("copyStatus").textContent = "Copied. Paste it into WhatsApp."; }
  catch (_) { $("copyStatus").textContent = "Copy was blocked by your browser."; }
});

/* ---------------- settings ---------------- */
const S = { price: "price_per_kg", cost: "cost_per_kg", salary: "salary", reinvest: "reinvest_pct", a: "partner_a", b: "partner_b" };
function fillSettings() {
  Object.entries(S).forEach(([k, f]) => { $("s-" + k).value = settings[f] ?? ""; $("s-" + k).disabled = !isOwner(); });
  $("setSave").hidden = !isOwner();
  $("setNote").textContent = isOwner() ? "New prices apply to days saved from now on. Saved days keep the buying cost they were saved with." : "Only the owner can change these.";
  $("e-by").innerHTML = [settings.partner_a, settings.partner_b, "Shop takings"].map(n => '<option>' + esc(n) + '</option>').join("");
}
$("setForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const s = {}; Object.entries(S).forEach(([k, f]) => s[f] = (k === "a" || k === "b") ? $("s-" + k).value.trim() : num($("s-" + k).value));
  s.updated_at = new Date().toISOString();
  $("setStatus").textContent = "Saving…";
  const { error } = await sb.from("settings").update(s).eq("id", 1);
  if (error) { $("setStatus").textContent = "Couldn't save settings."; return; }
  $("setStatus").textContent = "Settings saved."; await loadSettings();
});

/* ---------------- users (owner) ---------------- */
async function loadUsers() {
  const { data, error } = await sb.from("profiles").select("*").order("created_at");
  if (error) { banner("Couldn't load users."); return; }
  users = data; renderUsers();
}
function renderUsers() {
  const list = $("userList"); list.innerHTML = "";
  users.forEach(u => {
    const d = document.createElement("div"); d.className = "person userrow";
    const info = document.createElement("div");
    const b = document.createElement("b"); b.textContent = u.full_name;
    const s = document.createElement("span"); s.textContent = "@" + u.username + (u.active ? "" : " · turned off");
    info.append(b, s);
    const acts = document.createElement("div"); acts.className = "row";
    if (u.role === "owner") {
      const tag = document.createElement("span"); tag.className = "chip"; tag.textContent = "Owner"; acts.append(tag);
    } else {
      const sel = document.createElement("select"); sel.setAttribute("aria-label", "Role for " + u.full_name);
      sel.innerHTML = '<option value="salesman">Salesman</option><option value="partner">Partner</option>'; sel.value = u.role;
      sel.onchange = () => updateUser(u.id, { role: sel.value });
      const tog = document.createElement("button"); tog.type = "button"; tog.className = "small " + (u.active ? "danger" : "ghost");
      tog.textContent = u.active ? "Turn off" : "Turn on";
      tog.onclick = () => updateUser(u.id, { active: !u.active });
      acts.append(sel, tog);
    }
    const rb = document.createElement("button"); rb.type = "button"; rb.className = "small ghost"; rb.textContent = "Reset password";
    const rf = document.createElement("form"); rf.className = "row full"; rf.hidden = true; rf.noValidate = true; rf.style.width = "100%";
    const pid = "rp-" + u.id;
    rf.innerHTML = '<label for="' + pid + '" style="flex:1">New password for this user<input id="' + pid + '" type="text" autocomplete="off" minlength="6"></label><button type="submit" class="small">Save</button><span class="status" role="status"></span>';
    rb.onclick = () => { rf.hidden = !rf.hidden; if (!rf.hidden) rf.querySelector("input").focus(); };
    rf.onsubmit = async ev => {
      ev.preventDefault();
      const pw = rf.querySelector("input").value, out = rf.querySelector(".status");
      if (pw.length < 6) { out.textContent = "At least 6 characters."; return; }
      const { error } = await sb.rpc("owner_set_password", { p_user: u.id, p_password: pw });
      out.textContent = error ? "Couldn't reset: " + error.message : "Done. New password: " + pw;
      if (!error) rf.querySelector("input").value = "";
    };
    if (u.role !== "owner") acts.append(rb);
    d.append(info, acts, rf); list.append(d);
  });
}
async function updateUser(id, patch) {
  const { error } = await sb.from("profiles").update(patch).eq("id", id);
  if (error) banner("Couldn't update that user."); else loadUsers();
}
$("userForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const full_name = $("u-name").value.trim(), username = $("u-user").value.trim().toLowerCase(), password = $("u-pass").value, role = $("u-role").value;
  const st = $("u-status");
  if (!full_name || !username || !password) { st.textContent = "Fill in name, username and password."; return; }
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) { st.textContent = "Username: 3–30 letters, numbers, dots, dashes."; return; }
  if (password.length < 6) { st.textContent = "Password must be at least 6 characters."; return; }
  if (users.some(u => u.username === username)) { st.textContent = "That username is taken."; return; }
  $("u-btn").disabled = true; st.textContent = "Creating…";
  try {
    const { error } = await sb.rpc("owner_create_user", { p_email: emailFor(username), p_password: password, p_username: username, p_full_name: full_name, p_role: role });
    if (error) throw new Error(error.message);
    st.textContent = "Created " + full_name + ". Username: " + username + " · Password: " + password;
    $("u-name").value = ""; $("u-user").value = ""; $("u-pass").value = "";
    loadUsers();
  } catch (err) { st.textContent = "Couldn't create user: " + err.message; }
  finally { $("u-btn").disabled = false; }
});

/* ---------------- reports (partners) ---------------- */
let allDays = [], allExp = [];
async function loadReports() {
  const [d, x] = await Promise.all([
    sb.from("days").select("*").order("day", { ascending: false }).limit(5000),
    sb.from("expenses").select("date,amount").limit(5000)
  ]);
  if (d.error || x.error) { banner("Couldn't load reports. Check your internet."); return; }
  banner("");
  allDays = d.data; allExp = x.data;
  const years = [...new Set(allDays.map(r => r.day.slice(0, 4)).concat(allExp.map(e => e.date.slice(0, 4))))].sort().reverse();
  if (!years.length) years.push(today().slice(0, 4));
  const ys = $("r-year"), keep = ys.value;
  ys.innerHTML = years.map(y => '<option>' + y + '</option>').join("");
  ys.value = years.includes(keep) ? keep : years[0];
  renderReports();
}
function renderReports() {
  const y = $("r-year").value;
  const days = allDays.filter(r => r.day.startsWith(y));
  const months = {};
  days.forEach(r => {
    const ym = r.day.slice(0, 7), c = calc(r);
    const m = months[ym] || (months[ym] = { kg: 0, total: 0, cogs: 0, open: 0, exp: 0, short: 0 });
    m.kg += c.kg; m.total += c.total; m.cogs += c.cogs; if (c.opened) m.open++;
    if (c.received > 0 && c.diff < -.5) m.short += -c.diff;
  });
  allExp.filter(e => e.date.startsWith(y)).forEach(e => {
    const ym = e.date.slice(0, 7);
    (months[ym] || (months[ym] = { kg: 0, total: 0, cogs: 0, open: 0, exp: 0, short: 0 })).exp += num(e.amount);
  });
  const rp = Math.min(100, Math.max(0, num(settings.reinvest_pct)));
  const yt = { kg: 0, total: 0, net: 0, share: 0, short: 0 };
  const keys = Object.keys(months).sort().reverse();
  $("rMonths").querySelector("tbody").innerHTML = keys.map(ym => {
    const m = months[ym], salary = m.open > 0 ? num(settings.salary) : 0;
    const net = m.total - m.cogs - salary - m.exp, each = (net - (net > 0 ? net * rp / 100 : 0)) / 2;
    yt.kg += m.kg; yt.total += m.total; yt.net += net; yt.share += each; yt.short += m.short;
    const [yy, mm] = ym.split("-");
    return '<tr class="link" tabindex="0" data-month="' + ym + '"><td>' + MONTHS[+mm - 1] + ' ' + yy + '</td><td>' + m.open + '</td><td>' + kgf(m.kg) + '</td><td>' + naira(m.total) +
      '</td><td>' + naira(m.cogs) + '</td><td>' + naira(salary) + '</td><td>' + naira(m.exp) + '</td><td' + (net < 0 ? ' class="neg"' : '') + '><b>' + naira(net) + '</b></td><td>' + naira(each) + '</td></tr>';
  }).join("");
  $("rMonthsEmpty").hidden = keys.length > 0;
  $("rTiles").innerHTML = tile("Sales in " + y, naira(yt.total)) + tile("Gas sold", kgf(yt.kg)) + tile("Cash short", naira(yt.short)) + tile("Net profit", naira(yt.net), "profit");

  const ms = $("r-month"), keepM = ms.value;
  ms.innerHTML = '<option value="">All of ' + y + '</option>' + keys.map(ym => { const [yy, mm] = ym.split("-"); return '<option value="' + ym + '">' + MONTHS[+mm - 1] + ' ' + yy + '</option>'; }).join("");
  ms.value = keys.includes(keepM) ? keepM : "";
  renderReportDays();
}
function renderReportDays() {
  const y = $("r-year").value, ym = $("r-month").value;
  const rows = allDays.filter(r => r.day.startsWith(ym || y));
  $("rDays").querySelector("tbody").innerHTML = rows.map(r => {
    const c = calc(r);
    return '<tr class="link" tabindex="0" data-day="' + r.day + '"><td>' + fmtDate(r.day) + ' ' + r.day.slice(0, 4) + '</td><td class="text">' + esc(r.seller) + '</td><td>' + kgf(c.kg) + '</td><td>' + naira(c.gasSales) +
      '</td><td>' + naira(c.acc) + '</td><td><b>' + naira(c.total) + '</b></td><td>' + naira(c.received) + '</td><td>' + cashPill(c) + '</td><td class="notes">' + esc(r.notes) + '</td></tr>';
  }).join("");
  $("rDaysEmpty").hidden = rows.length > 0;
}
$("r-year").addEventListener("change", renderReports);
$("r-month").addEventListener("change", renderReportDays);
function openRow(e) {
  const tr = e.target.closest("tr.link"); if (!tr) return;
  if (e.type === "keydown" && e.key !== "Enter") return;
  if (tr.dataset.month) { $("m-month").value = tr.dataset.month; location.hash = "monthly"; }
  if (tr.dataset.day) { $("d-date").value = tr.dataset.day; fillForm(tr.dataset.day); location.hash = "daily"; }
}
["click", "keydown"].forEach(t => { $("rMonths").addEventListener(t, openRow); $("rDays").addEventListener(t, openRow); });

/* ---------------- routing ---------------- */
const VIEWS = ["reports", "daily", "monthly", "settings", "users"];
function allowed(v) { return v === "daily" || (v === "users" ? isOwner() : isPartner()); }
function route() {
  if (!me) return;
  let v = location.hash.slice(1); if (!VIEWS.includes(v) || !allowed(v)) v = isPartner() ? "reports" : "daily";
  VIEWS.forEach(n => $("view-" + n).hidden = n !== v);
  document.querySelectorAll("#tabs a").forEach(a => { a.removeAttribute("aria-current"); if (a.dataset.view === v) a.setAttribute("aria-current", "page"); });
  if (v === "monthly") loadMonth();
  if (v === "reports") loadReports();
  if (v === "users") loadUsers();
  if (v === "daily") loadRecent();
}
window.addEventListener("hashchange", route);

let recovering = false;
sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_OUT") showLogin(); if (evt === "PASSWORD_RECOVERY") { recovering = true; showReset(); } });
start();
})();
