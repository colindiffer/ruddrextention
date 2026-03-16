import { getMemberId, setMemberId, getMemberEmail, getLastUsedProjectId, setLastUsedProjectId, getLastUsedTaskId, setLastUsedTaskId, addRecentProject, getTimerState, setTimerState, clearTimerState, getFavouriteProjects, setFavouriteProjects } from '../lib/storage.js';
import { listTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry, listProjectMembers, listProjectTasks, listMembers, getProject, listAllocationsForMember } from '../lib/api.js';
import { trackEvent, trackView } from '../lib/analytics.js';

// --- State ---
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
let entries = [];
let weekEntries = [];
let projects = []; // { id, name, clientName } sorted alphabetically
let memberProjectMap = {}; // projectId -> project-member record (includes roles)
let editingEntry = null; // null = new, object = editing
let timerInterval = null; // setInterval handle for live timer display
let timerState = null; // running timer derived from API — no local persistence
let loginPollInterval = null;
let lastLoadAt = 0; // debounce focus reloads
let loginPollStartedAt = 0;
let reloginMode = false; // true when session expired but memberId already known
let projectHoursCache = {}; // projectId -> { budgetHours, loggedHours } — cleared on month change
let monthEntriesCache = null; // { key: 'YYYY-MM', entries: [] } — shared between month total and project stats
let allocationsCache = null; // all allocations for current member, fetched once per session

// --- DOM refs ---
const setupView = document.getElementById('setupView');
const weeklyView = document.getElementById('weeklyView');
const entryView = document.getElementById('entryView');
const setupEmail = document.getElementById('setupEmail');
const setupEmailField = document.getElementById('setupEmailField');
const setupHeading = document.getElementById('setupHeading');
const setupSubtitle = document.getElementById('setupSubtitle');
const setupStatus = document.getElementById('setupStatus');
const openLoginBtn = document.getElementById('openLoginBtn');
const settingsBtn = document.getElementById('settingsBtn');
const prevDayBtn = document.getElementById('prevDay');
const nextDayBtn = document.getElementById('nextDay');
const dayPillsContainer = document.getElementById('dayPills');
const dayContainer = document.getElementById('dayContainer');
const dailyTotalEl = document.getElementById('dailyTotal');
const addEntryBtn = document.getElementById('addEntryBtn');
const backBtn = document.getElementById('backBtn');
const entryTitle = document.getElementById('entryTitle');
const entryForm = document.getElementById('entryForm');
const projectSelect = document.getElementById('projectSelect');
const taskSelect = document.getElementById('taskSelect');
const roleSelect = document.getElementById('roleSelect');
const dateHoursRow = document.getElementById('dateHoursRow');
const entryDate = document.getElementById('entryDate');
const entryHours = document.getElementById('entryHours');
const entryNotes = document.getElementById('entryNotes');
const deleteEntryBtn = document.getElementById('deleteEntryBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveEntryBtn = document.getElementById('saveEntryBtn');
const startTimerSubmitBtn = document.getElementById('startTimerSubmitBtn');
const deleteModal = document.getElementById('deleteModal');
const deleteCancelBtn = document.getElementById('deleteCancelBtn');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
const timerBar = document.getElementById('timerBar');
const timerDisplay = document.getElementById('timerDisplay');
const timerProject = document.getElementById('timerProject');
const timerStopBtn = document.getElementById('timerStopBtn');
const timerResumeBtn = document.getElementById('timerResumeBtn');
const timerDismissBtn = document.getElementById('timerDismissBtn');
const weekHours = document.getElementById('weekHours');
const weekStatusBadge = document.getElementById('weekStatusBadge');
const submitWeekBtn = document.getElementById('submitWeekBtn');
const copyLastWeekBtn = document.getElementById('copyLastWeekBtn');
const copyModal = document.getElementById('copyModal');
const copyCancelBtn = document.getElementById('copyCancelBtn');
const copyConfirmBtn = document.getElementById('copyConfirmBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const projectStats = document.getElementById('projectStats');
const projectStatsBar = document.getElementById('projectStatsBar');
const projectStatsFill = document.getElementById('projectStatsFill');
const projectStatsText = document.getElementById('projectStatsText');
const monthHoursLabel = document.getElementById('monthHoursLabel');
const monthHoursEl = document.getElementById('monthHours');
const monthOverviewBtn = document.getElementById('monthOverviewBtn');
const monthlyPanel = document.getElementById('monthlyPanel');
const monthlyPanelTitle = document.getElementById('monthlyPanelTitle');
const monthlyPanelBody = document.getElementById('monthlyPanelBody');
const monthlyPanelClose = document.getElementById('monthlyPanelClose');

// --- Helpers ---
function addDays(d, n) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayLabel(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function minutesToHours(min) {
  return +(min / 60).toFixed(2);
}

function hoursToMinutes(h) {
  return Math.round(h * 60);
}

function fmtHours(h) {
  return (h % 1 === 0 ? h : +h.toFixed(1)) + 'h';
}

function isToday(d) {
  const today = new Date();
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

function getWeekStart(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function showToast(message, type = 'error') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function setStatus(el, message, type = '') {
  el.textContent = message;
  el.className = `status-msg ${type}`;
}

function showView(view) {
  [setupView, weeklyView, entryView].forEach((v) => v.classList.add('hidden'));
  view.classList.remove('hidden');

  const viewNames = {
    [setupView.id]: 'Setup',
    [weeklyView.id]: 'Weekly View',
    [entryView.id]: 'Entry Form'
  };
  trackView(viewNames[view.id] || view.id);
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getCookiesForUrl(url) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ url }, (cookies) => resolve(cookies || []));
  });
}

async function isRuddrLoggedIn() {
  const [rootCookies, wwwCookies] = await Promise.all([
    getCookiesForUrl('https://ruddr.io/'),
    getCookiesForUrl('https://www.ruddr.io/'),
  ]);
  const cookies = [...rootCookies, ...wwwCookies];
  const hasSession = cookies.some((c) => c.name === 'session');
  const hasSessionSig = cookies.some((c) => c.name === 'session.sig');
  return Boolean(hasSession && hasSessionSig);
}

// --- Timer Display ---
async function initTimerBar() {
  stopTimerTick();
  const state = await getTimerState();
  if (state) {
    timerState = state;
    showTimerBar(state);
    startTimerTick(state);
  } else {
    timerState = null;
    timerBar.classList.add('hidden');
  }
}

function showTimerBar(state) {
  timerBar.classList.remove('hidden', 'paused');
  const project = projects.find((p) => p.id === state.projectId);
  timerProject.textContent = project ? project.name : (state.projectName || 'Timer');
  updateTimerDisplay(state);
  timerStopBtn.classList.remove('hidden');
  timerResumeBtn.classList.add('hidden');
  timerDismissBtn.classList.add('hidden');
}

function updateTimerDisplay(state) {
  const elapsedMs = Date.now() - state.startedAt;
  const accMs = (state.accumulatedMinutes || 0) * 60000;
  timerDisplay.textContent = formatElapsed(elapsedMs + accMs);
}


function startTimerTick(state) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    updateTimerDisplay(state);
  }, 1000);
}

function stopTimerTick() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// --- Init ---
async function init() {
  const loggedIn = await isRuddrLoggedIn();
  const memberId = await getMemberId();

  if (!loggedIn || !memberId) {
    if (loggedIn && !memberId) {
      const linked = await attemptLinkMemberFromPendingEmail();
      if (linked) {
        trackEvent('login_success', { method: 'cookie_link' });
        await startAppView();
        return;
      }
    }
    // Session expired but we know who the user is — skip email entry step
    showSetupView(!loggedIn && !!memberId);
    return;
  }

  // Verify the stored memberId matches the expected user (once per 24h) — prevents
  // showing another person's data if stored identity ever becomes stale or mismatched.
  const identityValid = await verifyStoredIdentity(memberId);
  if (!identityValid) {
    await chrome.storage.local.remove(['memberId', 'memberName', 'memberEmail', 'identityVerifiedAt']);
    showSetupView(false);
    return;
  }

  trackEvent('app_start');
  await startAppView();
}

async function verifyStoredIdentity(memberId) {
  const VERIFY_TTL = 24 * 60 * 60 * 1000;
  const { identityVerifiedAt } = await chrome.storage.local.get('identityVerifiedAt');
  if (identityVerifiedAt && Date.now() - identityVerifiedAt < VERIFY_TTL) return true;

  try {
    const members = await listMembers();
    const member = members.find((m) => m.id === memberId);
    if (!member) return false;
    const storedEmail = await getMemberEmail();
    if (storedEmail && member.email && member.email.toLowerCase() !== storedEmail.toLowerCase()) {
      console.warn('[identity] Email mismatch — stored:', storedEmail, 'actual:', member.email);
      return false;
    }
    await chrome.storage.local.set({ identityVerifiedAt: Date.now() });
    return true;
  } catch {
    // Network error: trust stored identity to avoid locking out users offline
    return true;
  }
}

async function startAppView() {
  stopLoginPolling();
  showView(weeklyView);
  await loadDay();
}

function showSetupView(isRelogin = false) {
  reloginMode = isRelogin;
  if (isRelogin) {
    setupHeading.textContent = 'Session expired';
    setupSubtitle.textContent = 'Your session has expired. Click below to sign back in.';
    setupEmailField.classList.add('hidden');
    openLoginBtn.textContent = 'Sign in to Ruddr';
  } else {
    setupHeading.textContent = 'Welcome to Ruddr';
    setupSubtitle.textContent = 'Enter your email, then log in to Ruddr.';
    setupEmailField.classList.remove('hidden');
    openLoginBtn.textContent = 'Login at Ruddr';
  }
  showView(setupView);
  startLoginPolling();
}

const LOGIN_POLL_INTERVAL_MS = 2000;
const LOGIN_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function startLoginPolling() {
  if (loginPollInterval) return;
  loginPollStartedAt = Date.now();
  loginPollInterval = setInterval(async () => {
    if (Date.now() - loginPollStartedAt > LOGIN_POLL_TIMEOUT_MS) {
      stopLoginPolling();
      setStatus(setupStatus, reloginMode ? 'Login not detected. Try again.' : 'Still not linked. You can retry or change email.', 'error');
      return;
    }
    const loggedIn = await isRuddrLoggedIn();
    if (!loggedIn) return;
    if (reloginMode) {
      await startAppView();
    } else {
      const linked = await attemptLinkMemberFromPendingEmail();
      if (linked) await startAppView();
    }
  }, LOGIN_POLL_INTERVAL_MS);
}

function stopLoginPolling() {
  if (loginPollInterval) {
    clearInterval(loginPollInterval);
    loginPollInterval = null;
    loginPollStartedAt = 0;
  }
}

async function attemptLinkMemberFromPendingEmail() {
  const { pendingEmail } = await chrome.storage.local.get('pendingEmail');
  if (!pendingEmail) {
    setStatus(setupStatus, 'Enter your email, then continue to Ruddr.', 'error');
    return false;
  }
  try {
    const members = await listMembers();
    const match = members.find((m) =>
      (m.email || '').toLowerCase() === String(pendingEmail).toLowerCase()
    );
    if (!match) {
      setStatus(setupStatus, 'Email not found in Ruddr. Double-check your address.', 'error');
      return false;
    }

    await chrome.storage.local.remove('pendingEmail');
    await setMemberId(match.id);
    await chrome.storage.local.set({ memberName: match.name, memberEmail: match.email || pendingEmail });
    showToast(`Signed in as ${match.name}`, 'success');
    setStatus(setupStatus, '', '');
    trackEvent('login_success', { method: 'manual_email' });
    return true;
  } catch (err) {
    console.error('Linking failed:', err);
    setStatus(setupStatus, 'Linking failed. Please try again.', 'error');
    return false;
  }
}

// --- Week Status ---
async function loadWeekStatus() {
  try {
    const weekStart = getWeekStart(currentDate);
    const weekEnd = addDays(weekStart, 6);
    const memberId = await getMemberId();
    const response = await listTimeEntries({
      memberId,
      dateOnOrAfter: formatDate(weekStart),
      dateOnOrBefore: formatDate(weekEnd),
    });
    const weekStartStr = formatDate(weekStart);
    const weekEndStr = formatDate(weekEnd);
    weekEntries = (response.results || []).filter((e) => e.date >= weekStartStr && e.date <= weekEndStr);
    renderWeekStatus();
  } catch {
    // fail silently
  }
}

function renderWeekStatus() {
  const totalMinutes = weekEntries.reduce((s, e) => s + (e.minutes || 0), 0);
  weekHours.textContent = minutesToHours(totalMinutes) + 'h';

  if (weekEntries.length === 0) {
    weekStatusBadge.textContent = 'No entries';
    weekStatusBadge.className = 'week-badge week-badge-none';
    submitWeekBtn.classList.add('hidden');
    return;
  }

  const statuses = weekEntries.map((e) => e.statusId || 'not_submitted');
  let overall;
  if (statuses.every((s) => s === 'approved')) {
    overall = 'approved';
  } else if (statuses.every((s) => s === 'pending_approval' || s === 'approved')) {
    overall = 'pending_approval';
  } else if (statuses.some((s) => s === 'rejected')) {
    overall = 'rejected';
  } else if (statuses.some((s) => s === 'pending_approval')) {
    overall = 'mixed';
  } else {
    overall = 'not_submitted';
  }

  const labels = {
    not_submitted: 'Not submitted',
    pending_approval: 'Submitted',
    approved: 'Approved',
    rejected: 'Rejected',
    mixed: 'Partially submitted',
  };
  weekStatusBadge.textContent = labels[overall];
  weekStatusBadge.className = `week-badge week-badge-${overall.replace(/_/g, '-')}`;

  if (overall === 'approved') {
    submitWeekBtn.classList.add('hidden');
  } else if (overall === 'pending_approval') {
    submitWeekBtn.textContent = 'Unsubmit';
    submitWeekBtn.dataset.action = 'unsubmit';
    submitWeekBtn.classList.remove('hidden');
  } else {
    submitWeekBtn.textContent = 'Submit Week';
    submitWeekBtn.dataset.action = 'submit';
    submitWeekBtn.classList.remove('hidden');
  }
}

// --- Shared month entries fetch (cached per month) ---
async function getMonthEntries() {
  const key = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  if (monthEntriesCache && monthEntriesCache.key === key) return monthEntriesCache.entries;

  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const memberId = await getMemberId();
  const monthStartStr = formatDate(monthStart);
  const monthEndStr = formatDate(monthEnd);
  const response = await listTimeEntries({
    memberId,
    dateOnOrAfter: monthStartStr,
    dateOnOrBefore: monthEndStr,
    limit: 500,
  });
  const entries = (response.results || []).filter((e) => e.date >= monthStartStr && e.date <= monthEndStr);
  monthEntriesCache = { key, entries };
  return entries;
}

async function getAllocations() {
  if (allocationsCache) return allocationsCache;
  const memberId = await getMemberId();
  allocationsCache = await listAllocationsForMember(memberId);
  return allocationsCache;
}

function getPlannedHoursForProject(allocations, projectId) {
  const monthStartStr = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  const monthEndStr = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));
  return allocations
    .filter((a) => a.project?.id === projectId)
    .filter((a) => a.start <= monthEndStr && a.end >= monthStartStr)
    .reduce((s, a) => s + (a.hoursPerMonth || 0), 0);
}

// --- Month Status ---
async function loadMonthStatus() {
  try {
    const entries = await getMonthEntries();
    const monthMinutes = entries.reduce((s, e) => s + (e.minutes || 0), 0);
    monthHoursEl.textContent = fmtHours(minutesToHours(monthMinutes));
    monthHoursLabel.classList.remove('hidden');
  } catch {
    // fail silently
  }
}

async function showMonthlyOverview() {
  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  monthlyPanelTitle.textContent = monthName;
  monthlyPanelBody.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading…</span></div>';
  monthlyPanel.classList.remove('hidden');

  try {
    const entries = await getMonthEntries();

    const projectMap = {};
    for (const e of entries) {
      if (!e.project) continue;
      if ((e.task?.name || '').trim().toLowerCase() === 'account development') continue;
      const pid = e.project.id;
      if (!projectMap[pid]) {
        projectMap[pid] = { id: pid, name: e.project.name || '(unknown)', minutes: 0, budgetHours: null };
      }
      projectMap[pid].minutes += e.minutes || 0;
    }

    const projects = Object.values(projectMap).sort((a, b) => b.minutes - a.minutes);

    const allocations = await getAllocations().catch(() => []);
    for (const p of projects) {
      if (projectHoursCache[p.id]) {
        p.budgetHours = projectHoursCache[p.id].budgetHours;
      } else {
        const planned = getPlannedHoursForProject(allocations, p.id);
        p.budgetHours = planned > 0 ? planned : null;
      }
    }

    const totalMinutes = projects.reduce((s, p) => s + p.minutes, 0);
    const totalLoggedH = minutesToHours(totalMinutes);
    const budgetedProjects = projects.filter((p) => p.budgetHours !== null);
    const totalBudgetH = budgetedProjects.reduce((s, p) => s + p.budgetHours, 0);
    const totalLoggedBudgetedH = budgetedProjects.reduce((s, p) => s + minutesToHours(p.minutes), 0);
    const totalRemainingH = totalBudgetH - totalLoggedBudgetedH;

    let html = '';

    html += '<div class="monthly-overall">';
    html += '<div class="monthly-overall-label">Total logged</div>';
    html += `<div class="monthly-overall-hours">${fmtHours(totalLoggedH)}</div>`;
    if (budgetedProjects.length > 0) {
      const isOver = totalRemainingH < 0;
      const pct = Math.min(100, (totalLoggedBudgetedH / totalBudgetH) * 100);
      html += `<div class="monthly-overall-sub">${isOver ? fmtHours(-totalRemainingH) + ' over budget' : fmtHours(totalRemainingH) + ' remaining'} of ${fmtHours(totalBudgetH)} budgeted</div>`;
      html += `<div class="monthly-overall-bar"><div class="monthly-overall-bar-fill${isOver ? ' over' : ''}" style="width:${pct}%"></div></div>`;
    }
    html += '</div>';

    if (projects.length === 0) {
      html += '<div class="empty-state">No entries this month</div>';
    } else {
      html += '<div class="monthly-section-title">By project</div>';
      for (const p of projects) {
        const loggedH = minutesToHours(p.minutes);
        html += '<div class="monthly-project-item">';
        html += `<div class="monthly-project-name">${p.name}</div>`;
        if (p.budgetHours !== null) {
          const pct = Math.min(100, (loggedH / p.budgetHours) * 100);
          const over = loggedH > p.budgetHours;
          const remaining = p.budgetHours - loggedH;
          html += `<div class="monthly-project-bar"><div class="monthly-project-bar-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>`;
          html += `<div class="monthly-project-stats">${fmtHours(loggedH)} of ${fmtHours(p.budgetHours)} budget · <span${over ? ' class="over-text"' : ''}>${over ? fmtHours(-remaining) + ' over' : fmtHours(remaining) + ' left'}</span></div>`;
        } else {
          html += `<div class="monthly-project-stats">${fmtHours(loggedH)} logged</div>`;
        }
        html += '</div>';
      }
    }

    monthlyPanelBody.innerHTML = html;
  } catch {
    monthlyPanelBody.innerHTML = '<div class="empty-state">Failed to load overview.</div>';
  }
}

// --- Project Hours Stats ---
async function loadProjectStats(projectId) {
  if (!projectStats) return;

  if (projectHoursCache[projectId]) {
    renderProjectStats(projectId, projectHoursCache[projectId]);
    return;
  }

  projectStats.classList.remove('hidden');
  projectStatsBar.classList.add('hidden');
  projectStatsText.textContent = 'Loading…';

  try {
    const [allocations, monthEntries] = await Promise.all([
      getAllocations().catch(() => []),
      getMonthEntries().catch(() => []),
    ]);

    const plannedHours = getPlannedHoursForProject(allocations, projectId);
    const budgetHours = plannedHours > 0 ? plannedHours : null;
    const loggedMinutes = monthEntries
      .filter((e) => e.project?.id === projectId)
      .filter((e) => (e.task?.name || '').trim().toLowerCase() !== 'account development')
      .reduce((s, e) => s + (e.minutes || 0), 0);
    const loggedHours = minutesToHours(loggedMinutes);

    const stats = { budgetHours, loggedHours };
    projectHoursCache[projectId] = stats;
    renderProjectStats(projectId, stats);
  } catch {
    projectStats.classList.add('hidden');
  }
}

function renderProjectStats(projectId, { budgetHours, loggedHours }) {
  projectStats.classList.remove('hidden');

  const monthName = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    .toLocaleString('default', { month: 'long' });

  if (budgetHours) {
    const remaining = budgetHours - loggedHours;
    const isOver = remaining < 0;
    const pct = Math.min(100, Math.round((loggedHours / budgetHours) * 100));

    projectStatsBar.classList.remove('hidden');
    projectStatsFill.style.width = `${pct}%`;
    projectStatsFill.className = 'project-stats-fill' + (isOver ? ' over-budget' : '');

    const pctText = `${pct}%`;
    const remainText = isOver
      ? `${fmtHours(Math.abs(remaining))} over`
      : `${fmtHours(remaining)} left`;
    projectStatsText.textContent = `${monthName} · Logged: ${fmtHours(loggedHours)} · Assigned: ${fmtHours(budgetHours)} · ${pctText} · ${remainText}`;
  } else {
    projectStatsBar.classList.add('hidden');
    projectStatsText.textContent = `${monthName}: ${fmtHours(loggedHours)} logged`;
  }
}

// --- Day View ---
async function loadDay() {
  lastLoadAt = Date.now();
  deleteSelectedBtn.classList.add('hidden');
  deleteSelectedBtn.disabled = false;
  deleteSelectedBtn.textContent = 'Delete selected';
  const loggedIn = await isRuddrLoggedIn();
  if (!loggedIn) {
    showSetupView();
    return;
  }
  updateDayLabel();
  const dateStr = formatDate(currentDate);

  dayContainer.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading entries...</span></div>';

  try {
    const memberId = await getMemberId();
    const response = await listTimeEntries({
      memberId,
      dateOnOrAfter: dateStr,
      dateOnOrBefore: dateStr,
    });
    // Client-side date filter as safety net
    const allEntries = response.results || [];
    entries = allEntries.filter((e) => e.date === dateStr);
    await renderDay();
    initTimerBar();
  } catch (err) {
    dayContainer.innerHTML = `<div class="empty-state">Failed to load entries.<br><small>${err.message}</small></div>`;
  }
  loadWeekStatus(); // non-awaited: updates week bar independently
  loadMonthStatus(); // non-awaited: updates month total in week bar
  loadEntryProjectStats(); // non-awaited: updates per-project stats on entry cards
}

async function loadEntryProjectStats() {
  try {
    const [allocations, monthEntries] = await Promise.all([
      getAllocations().catch(() => []),
      getMonthEntries().catch(() => []),
    ]);

    const statEls = dayContainer.querySelectorAll('.entry-month-stat[data-project-id]');
    const seen = {};

    statEls.forEach((el) => {
      const projectId = el.dataset.projectId;

      if (seen[projectId]) {
        el.innerHTML = seen[projectId];
        return;
      }

      const loggedMinutes = monthEntries
        .filter((e) => e.project?.id === projectId)
        .filter((e) => (e.task?.name || '').trim().toLowerCase() !== 'account development')
        .reduce((s, e) => s + (e.minutes || 0), 0);
      const loggedH = minutesToHours(loggedMinutes);
      const plannedH = getPlannedHoursForProject(allocations, projectId);

      if (plannedH > 0) {
        const pct = Math.min(100, Math.round((loggedH / plannedH) * 100));
        const remaining = plannedH - loggedH;
        const over = remaining < 0;
        const remainText = over ? `${fmtHours(-remaining)} over` : `${fmtHours(remaining)} left`;
        el.classList.toggle('over-stat', over);
        el.innerHTML =
          `<div class="entry-stat-bar"><div class="entry-stat-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>` +
          `<span>${fmtHours(loggedH)} / ${fmtHours(plannedH)} · ${pct}% · ${remainText}</span>`;
      } else {
        el.innerHTML = `<span>${fmtHours(loggedH)} this month</span>`;
      }

      seen[projectId] = el.innerHTML;
    });
  } catch {
    // fail silently
  }
}

function updateDayLabel() {
  const weekStart = getWeekStart(currentDate);
  const weekEnd = addDays(weekStart, 6);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthYearLabel = document.getElementById('monthYearLabel');
  if (weekStart.getMonth() === weekEnd.getMonth()) {
    monthYearLabel.textContent = `${monthNames[weekStart.getMonth()]} ${weekStart.getFullYear()}`;
  } else if (weekStart.getFullYear() === weekEnd.getFullYear()) {
    monthYearLabel.textContent = `${monthNames[weekStart.getMonth()].slice(0, 3)} / ${monthNames[weekEnd.getMonth()].slice(0, 3)} ${weekStart.getFullYear()}`;
  } else {
    monthYearLabel.textContent = `${monthNames[weekStart.getMonth()].slice(0, 3)} ${weekStart.getFullYear()} / ${monthNames[weekEnd.getMonth()].slice(0, 3)} ${weekEnd.getFullYear()}`;
  }
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  dayPillsContainer.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const btn = document.createElement('button');
    btn.className = 'day-pill';
    if (d.getTime() === today.getTime()) btn.classList.add('today');
    if (d.getTime() === currentDate.getTime()) btn.classList.add('selected');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'pill-name';
    nameSpan.textContent = dayNames[i];
    const dateSpan = document.createElement('span');
    dateSpan.className = 'pill-date';
    dateSpan.textContent = d.getDate();
    btn.appendChild(nameSpan);
    btn.appendChild(dateSpan);
    btn.addEventListener('click', () => {
      currentDate = d;
      loadDay();
    });
    dayPillsContainer.appendChild(btn);
  }
}

async function renderDay() {
  if (entries.length === 0) {
    const dayLabel = isToday(currentDate) ? 'today' : 'on ' + formatDayLabel(currentDate);
    dayContainer.innerHTML = `<div class="empty-state">No entries ${dayLabel}.<br>Click "+ New Entry" to add one.</div>`;
    dailyTotalEl.textContent = '0h';
    return;
  }

  // Dedup: group entries by project + task
  const groups = [];
  const groupMap = {};

  entries.forEach((e) => {
    const projectId = e.project?.id || '';
    const taskId = e.task?.id || '';
    const key = `${projectId}::${taskId}`;

    if (!groupMap[key]) {
      groupMap[key] = {
        key,
        projectId,
        projectName: e.project?.name || 'Unknown project',
        taskId,
        taskName: e.task?.name || '',
        roleId: e.role?.id || '',
        totalMinutes: 0,
        entries: [],
      };
      groups.push(groupMap[key]);
    }

    groupMap[key].totalMinutes += (e.minutes || 0);
    groupMap[key].entries.push(e);
  });

  const dayTotal = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);

  const favIds = await getFavouriteProjects();
  const favProjectIds = new Set(favIds.map((k) => k.split('::')[0]));
  let html = '<div class="day-entries">';

  groups.forEach((g) => {
    // Use the first entry for click-to-edit and play button
    const firstEntry = g.entries[0];
    const notes = g.entries.map((e) => e.notes).filter(Boolean);
    const uniqueNotes = [...new Set(notes)];
    const detail = [g.taskName, ...uniqueNotes].filter(Boolean).join(' \u00b7 ');
    const isFav = favProjectIds.has(g.projectId);

    const entryIds = g.entries.map((e) => e.id).join(',');
    html += `<div class="entry-item" data-id="${firstEntry.id}" data-entry-ids="${entryIds}" data-project-id="${g.projectId}">
      <input type="checkbox" class="entry-checkbox" data-entry-ids="${entryIds}">
      <div class="entry-info">
        <div class="entry-project">${escapeHtml(g.projectName)}</div>
        ${detail ? `<div class="entry-detail">${escapeHtml(detail)}</div>` : ''}
        <div class="entry-month-stat" data-project-id="${g.projectId}"></div>
      </div>
      <span class="entry-hours">${g.totalMinutes <= 1 ? '—' : `${minutesToHours(g.totalMinutes)}h`}</span>
      <button class="entry-fav-btn${isFav ? ' is-favourite' : ''}" data-project-id="${g.projectId}" data-task-id="${g.taskId || ''}" data-role-id="${g.roleId || ''}" title="${isFav ? 'Remove from favourites' : 'Add to favourites'}">${isFav ? '★' : '☆'}</button>
      <button class="entry-play-btn" data-id="${firstEntry.id}" title="Start timer">&#9654;</button>
    </div>`;
  });

  html += '</div>';

  dayContainer.innerHTML = html;
  dailyTotalEl.textContent = minutesToHours(dayTotal) + 'h';

  const dayEntriesEl = dayContainer.querySelector('.day-entries');

  function updateDeleteBtn() {
    const anyChecked = dayContainer.querySelector('.entry-checkbox:checked');
    deleteSelectedBtn.classList.toggle('hidden', !anyChecked);
    dayEntriesEl.classList.toggle('has-selection', !!anyChecked);
  }

  // Attach click handlers for entries
  dayContainer.querySelectorAll('.entry-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.entry-play-btn') || e.target.closest('.entry-fav-btn')) return;
      if (e.target.closest('.entry-checkbox')) return;
      const entry = entries.find((en) => en.id === el.dataset.id);
      if (entry) openEntryForm(entry);
    });
  });

  // Attach checkbox handlers
  dayContainer.querySelectorAll('.entry-checkbox').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      cb.closest('.entry-item').classList.toggle('selected', cb.checked);
      updateDeleteBtn();
    });
  });

  // Attach click handlers for play buttons
  dayContainer.querySelectorAll('.entry-play-btn').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = entries.find((en) => en.id === el.dataset.id);
      if (entry) startTimerOnEntry(entry);
    });
  });

  // Attach click handlers for star buttons
  dayContainer.querySelectorAll('.entry-fav-btn').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const projectId = el.dataset.projectId;
      const favKey = `${projectId}::${el.dataset.taskId || ''}::${el.dataset.roleId || ''}`;
      const currentFavIds = await getFavouriteProjects();
      const isCurrentlyFav = currentFavIds.some((id) => id.split('::')[0] === projectId);
      let newFavIds;
      if (isCurrentlyFav) {
        newFavIds = currentFavIds.filter((id) => id.split('::')[0] !== projectId);
        dayContainer.querySelectorAll(`.entry-fav-btn[data-project-id="${projectId}"]`).forEach((btn) => {
          btn.textContent = '☆';
          btn.classList.remove('is-favourite');
          btn.title = 'Add to favourites';
        });
      } else {
        newFavIds = [...currentFavIds, favKey];
        dayContainer.querySelectorAll(`.entry-fav-btn[data-project-id="${projectId}"]`).forEach((btn) => {
          btn.textContent = '★';
          btn.classList.add('is-favourite');
          btn.title = 'Remove from favourites';
        });
      }
      await setFavouriteProjects(newFavIds);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Entry Form ---
async function openEntryForm(entry = null, defaultDate = null) {
  editingEntry = entry;

  entryTitle.textContent = entry ? 'Edit Entry' : 'New Entry';
  deleteEntryBtn.classList.toggle('hidden', !entry);

  // Load member's projects if not cached
  if (projects.length === 0) {
    try {
      projectSelect.innerHTML = '<option value="">Loading projects...</option>';
      const memberId = await getMemberId();
      const allProjectMembers = await listProjectMembers();
      // Filter to current member's active project assignments
      const myMemberships = allProjectMembers.filter(
        (pm) => pm.member?.id === memberId && pm.isActive !== false
      );
      // Build project list and membership map
      memberProjectMap = {};
      projects = myMemberships
        .filter((pm) => pm.project)
        .map((pm) => {
          memberProjectMap[pm.project.id] = pm;
          return {
            id: pm.project.id,
            name: pm.project.name,
            clientName: pm.project.client?.name || '',
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      showToast('Failed to load projects: ' + err.message);
      return;
    }
  }

  // Populate project dropdown with favourites section
  const favProjectIds = new Set((await getFavouriteProjects()).map((k) => k.split('::')[0]));
  projectSelect.innerHTML = '<option value="">Select project...</option>';
  const favProjects = projects.filter((p) => favProjectIds.has(p.id));
  const otherProjects = projects.filter((p) => !favProjectIds.has(p.id));
  if (favProjects.length > 0) {
    const favGroup = document.createElement('optgroup');
    favGroup.label = '★ Favourites';
    favProjects.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.clientName ? ` (${p.clientName})` : '');
      favGroup.appendChild(opt);
    });
    projectSelect.appendChild(favGroup);
  }
  const allGroup = document.createElement('optgroup');
  allGroup.label = favProjects.length > 0 ? 'All Projects' : 'Projects';
  otherProjects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name + (p.clientName ? ` (${p.clientName})` : '');
    allGroup.appendChild(opt);
  });
  projectSelect.appendChild(allGroup);

  // Reset task/role dropdowns and project stats
  taskSelect.innerHTML = '<option value="">Select task...</option>';
  taskSelect.disabled = true;
  roleSelect.innerHTML = '<option value="">Select role...</option>';
  roleSelect.disabled = true;
  projectStats.classList.add('hidden');

  if (entry) {
    // Fill form with existing entry
    projectSelect.value = entry.project?.id || '';
    entryDate.value = entry.date;
    entryHours.value = entry.minutes <= 1 ? '' : minutesToHours(entry.minutes);
    entryNotes.value = entry.notes || '';
    // Load tasks & roles for the project
    if (entry.project?.id) {
      await loadProjectDetails(entry.project.id);
      taskSelect.value = entry.task?.id || '';
      roleSelect.value = entry.role?.id || '';
    }
  } else {
    // New entry / timer defaults
    entryDate.value = defaultDate || formatDate(currentDate);
    entryHours.value = '';
    entryNotes.value = '';

    // Pre-select last used project
    const lastProjectId = await getLastUsedProjectId();
    if (lastProjectId && projects.some((p) => p.id === lastProjectId)) {
      projectSelect.value = lastProjectId;
      await loadProjectDetails(lastProjectId);
      const lastTaskId = await getLastUsedTaskId();
      if (lastTaskId) taskSelect.value = lastTaskId;
    }
  }

  showView(entryView);
}

async function loadProjectDetails(projectId) {
  // Fetch tasks from API (project-level)
  let tasks = [];
  const tasksResult = await listProjectTasks(projectId).catch(() => null);
  if (tasksResult) {
    tasks = tasksResult.results || tasksResult || [];
    if (!Array.isArray(tasks)) tasks = [];
  }

  tasks.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Deduplicate tasks by name (keep first occurrence)
  const seenNames = new Set();
  tasks = tasks.filter((t) => {
    const name = (t.name || '').toLowerCase();
    if (seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  });

  taskSelect.innerHTML = '<option value="">No task</option>';
  tasks.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    taskSelect.appendChild(opt);
  });
  taskSelect.disabled = tasks.length === 0;

  // Get roles from member's project assignment (only roles assigned to this user)
  const membership = memberProjectMap[projectId];
  const roles = (membership?.roles) || [];

  roleSelect.innerHTML = '<option value="">No role</option>';
  roles.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    roleSelect.appendChild(opt);
  });
  roleSelect.disabled = roles.length === 0;

  loadProjectStats(projectId); // non-awaited: updates project hours bar
}

// --- Start Timer on Existing Entry (from weekly view) ---
async function startTimerOnEntry(entry) {
  if (timerState && timerState.entryId === entry.id) return; // already running on this entry
  if (timerState) {
    // Commit existing timer silently before starting new one
    const elapsedMs = Date.now() - timerState.startedAt;
    const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    const totalMinutes = (timerState.accumulatedMinutes || 0) + elapsedMinutes;
    try {
      await updateTimeEntry(timerState.entryId, { minutes: totalMinutes, notes: timerState.notes || '' });
    } catch {
      showToast('Warning: previous timer may not have saved');
    }
    stopTimerTick();
  }
  const state = {
    entryId: entry.id,
    projectId: entry.project?.id || '',
    projectName: entry.project?.name || '',
    notes: entry.notes || '',
    startedAt: Date.now(),
    accumulatedMinutes: entry.minutes || 0,
  };
  try {
    await setTimerState(state);
    timerState = state;
    showTimerBar(state);
    startTimerTick(state);
    chrome.runtime.sendMessage({ type: 'timerStarted' });
    showToast('Timer started', 'success');
    trackEvent('timer_start', { source: 'weekly_view' });
    await loadDay();
  } catch (err) {
    showToast('Failed to start timer: ' + err.message);
  }
}

// --- Timer Start (from entry form) ---
async function startTimer() {
  const projectId = projectSelect.value;
  const taskId = taskSelect.value || null;
  const roleId = roleSelect.value || null;
  const notes = entryNotes.value.trim();

  if (!projectId) {
    showToast('Please select a project');
    return;
  }
  if (!roleId && roleSelect.options.length > 1) {
    showToast('Please select a role');
    return;
  }

  startTimerSubmitBtn.disabled = true;

  // Commit any running timer first
  if (timerState) {
    const elapsedMs = Date.now() - timerState.startedAt;
    const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    const totalMinutes = (timerState.accumulatedMinutes || 0) + elapsedMinutes;
    try {
      await updateTimeEntry(timerState.entryId, { minutes: totalMinutes, notes: timerState.notes || '' });
    } catch {
      showToast('Warning: previous timer may not have saved');
    }
    stopTimerTick();
    timerState = null;
    await clearTimerState();
  }

  const memberId = await getMemberId();
  const project = projects.find((p) => p.id === projectId);
  const today = formatDate(new Date());

  const targetEntry = editingEntry || entries.find((e) =>
    e.date === today &&
    e.project?.id === projectId &&
    (e.task?.id || null) === taskId
  );

  try {
    let entryId, accumulatedMinutes;
    if (targetEntry) {
      entryId = targetEntry.id;
      accumulatedMinutes = targetEntry.minutes || 0;
    } else {
      const data = { typeId: 'project_time', projectId, memberId, date: today, minutes: 1, notes };
      if (taskId) data.taskId = taskId;
      if (roleId) data.roleId = roleId;
      const created = await createTimeEntry(data);
      entryId = created.id;
      accumulatedMinutes = 0;
    }

    const state = { entryId, projectId, projectName: project?.name || '', notes, startedAt: Date.now(), accumulatedMinutes };
    await setTimerState(state);
    timerState = state;

    await setLastUsedProjectId(projectId);
    if (taskId) await setLastUsedTaskId(taskId);
    if (project) await addRecentProject({ id: project.id, name: project.name, clientName: project.clientName });

    chrome.runtime.sendMessage({ type: 'timerStarted' });
    showView(weeklyView);
    showTimerBar(state);
    startTimerTick(state);
    showToast('Timer started', 'success');
    trackEvent('timer_start', { source: 'entry_form', is_new: !targetEntry });
    await loadDay();
  } catch (err) {
    showToast('Failed to start timer: ' + err.message);
  }

  startTimerSubmitBtn.disabled = false;
}

// --- Timer Stop ---
async function stopTimer() {
  if (!timerState) return;
  timerStopBtn.disabled = true;
  try {
    const elapsedMs = Date.now() - timerState.startedAt;
    const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    const totalMinutes = (timerState.accumulatedMinutes || 0) + elapsedMinutes;
    await updateTimeEntry(timerState.entryId, { minutes: totalMinutes, notes: timerState.notes || '' });
    await clearTimerState();
    timerState = null;
    stopTimerTick();
    timerBar.classList.add('hidden');
    chrome.runtime.sendMessage({ type: 'timerStopped' });
    showToast('Timer stopped', 'success');
    trackEvent('timer_stop', { duration_minutes: elapsedMinutes });
    await loadDay();
  } catch (err) {
    showToast('Failed to stop timer: ' + err.message);
  }
  timerStopBtn.disabled = false;
}

// --- Event Listeners ---

openLoginBtn.addEventListener('click', () => {
  if (!reloginMode) {
    const email = setupEmail.value.trim();
    if (!email) {
      setStatus(setupStatus, 'Please enter your email first.', 'error');
      return;
    }
    chrome.storage.local.set({ pendingEmail: email });
  }
  setStatus(setupStatus, 'Opening Ruddr login...', 'success');
  stopLoginPolling();
  startLoginPolling();
  chrome.tabs.create({ url: 'https://www.ruddr.io/login' });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

prevDayBtn.addEventListener('click', () => {
  const prevMonth = currentDate.getMonth();
  currentDate = addDays(currentDate, -7);
  if (currentDate.getMonth() !== prevMonth) { projectHoursCache = {}; monthEntriesCache = null; }
  loadDay();
});

nextDayBtn.addEventListener('click', () => {
  const prevMonth = currentDate.getMonth();
  currentDate = addDays(currentDate, 7);
  if (currentDate.getMonth() !== prevMonth) { projectHoursCache = {}; monthEntriesCache = null; }
  loadDay();
});

addEntryBtn.addEventListener('click', () => openEntryForm());

deleteSelectedBtn.addEventListener('click', async () => {
  const checked = [...dayContainer.querySelectorAll('.entry-checkbox:checked')];
  if (checked.length === 0) return;
  const ids = checked.flatMap((cb) => cb.dataset.entryIds.split(','));
  const label = `${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}`;
  if (!confirm(`Delete ${label}?`)) return;
  deleteSelectedBtn.disabled = true;
  deleteSelectedBtn.textContent = 'Deleting…';
  try {
    await Promise.all(ids.map((id) => deleteTimeEntry(id)));
    await loadDay();
  } catch (err) {
    showToast('Delete failed: ' + err.message);
    deleteSelectedBtn.disabled = false;
    deleteSelectedBtn.textContent = 'Delete selected';
  }
});

timerStopBtn.addEventListener('click', stopTimer);

submitWeekBtn.addEventListener('click', async () => {
  const action = submitWeekBtn.dataset.action;
  submitWeekBtn.disabled = true;
  try {
    if (action === 'submit') {
      const toSubmit = weekEntries.filter((e) => {
        const s = e.statusId || 'not_submitted';
        return s === 'not_submitted' || s === 'rejected';
      });
      await Promise.all(toSubmit.map((e) => updateTimeEntry(e.id, { statusId: 'pending_approval', notes: e.notes || '' })));
      showToast('Timesheet submitted', 'success');
      trackEvent('week_submit');
    } else {
      const toUnsubmit = weekEntries.filter((e) => e.statusId === 'pending_approval');
      await Promise.all(toUnsubmit.map((e) => updateTimeEntry(e.id, { statusId: 'not_submitted', notes: e.notes || '' })));
      showToast('Timesheet unsubmitted', 'success');
      trackEvent('week_unsubmit');
    }
    await loadWeekStatus();
    await loadDay();
  } catch (err) {
    showToast('Failed: ' + err.message);
  } finally {
    submitWeekBtn.disabled = false;
  }
});

startTimerSubmitBtn.addEventListener('click', startTimer);

backBtn.addEventListener('click', () => {
  showView(weeklyView);
});

cancelBtn.addEventListener('click', () => {
  showView(weeklyView);
});

projectSelect.addEventListener('change', async () => {
  const projectId = projectSelect.value;
  if (projectId) {
    await loadProjectDetails(projectId);
  } else {
    taskSelect.innerHTML = '<option value="">Select task...</option>';
    taskSelect.disabled = true;
    roleSelect.innerHTML = '<option value="">Select role...</option>';
    roleSelect.disabled = true;
    projectStats.classList.add('hidden');
  }
});

entryForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const projectId = projectSelect.value;
  const taskId = taskSelect.value;
  const roleId = roleSelect.value;
  const date = entryDate.value;
  const hours = parseFloat(entryHours.value);
  const notes = entryNotes.value.trim();

  if (!projectId) {
    showToast('Please select a project');
    return;
  }
  if (!roleId && roleSelect.options.length > 1) {
    showToast('Please select a role');
    return;
  }
  if (!date) {
    showToast('Please enter a date');
    return;
  }
  if (!hours || hours <= 0) {
    showToast('Please enter valid hours');
    return;
  }

  const data = {
    typeId: 'project_time',
    projectId,
    date,
    minutes: hoursToMinutes(hours),
    notes,
  };

  if (taskId) data.taskId = taskId;
  if (roleId) data.roleId = roleId;

  // Add memberId for new entries
  if (!editingEntry) {
    data.memberId = await getMemberId();
  }

  saveEntryBtn.disabled = true;
  saveEntryBtn.textContent = 'Saving...';

  try {
    if (editingEntry) {
      await updateTimeEntry(editingEntry.id, data);
      showToast('Entry updated', 'success');
      trackEvent('entry_save', { action: 'update' });
    } else {
      await createTimeEntry(data);
      showToast('Entry created', 'success');
      trackEvent('entry_save', { action: 'create' });
    }

    // Remember last used project/task
    await setLastUsedProjectId(projectId);
    if (taskId) await setLastUsedTaskId(taskId);

    const project = projects.find((p) => p.id === projectId);
    if (project) await addRecentProject({ id: project.id, name: project.name, clientName: project.clientName });

    showView(weeklyView);
    await loadDay();
  } catch (err) {
    showToast('Save failed: ' + err.message);
  } finally {
    saveEntryBtn.disabled = false;
    saveEntryBtn.textContent = 'Save';
  }
});

deleteEntryBtn.addEventListener('click', () => {
  deleteModal.classList.remove('hidden');
});

deleteCancelBtn.addEventListener('click', () => {
  deleteModal.classList.add('hidden');
});

deleteConfirmBtn.addEventListener('click', async () => {
  if (!editingEntry) return;

  deleteConfirmBtn.disabled = true;
  deleteConfirmBtn.textContent = 'Deleting...';

  try {
    await deleteTimeEntry(editingEntry.id);
    showToast('Entry deleted', 'success');
    deleteModal.classList.add('hidden');
    showView(weeklyView);
    await loadDay();
  } catch (err) {
    showToast('Delete failed: ' + err.message);
  } finally {
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = 'Delete';
  }
});


// --- Copy Over ---
copyLastWeekBtn.addEventListener('click', () => {
  copyModal.classList.remove('hidden');
});

monthOverviewBtn.addEventListener('click', () => showMonthlyOverview());

monthlyPanelClose.addEventListener('click', () => {
  monthlyPanel.classList.add('hidden');
});

copyCancelBtn.addEventListener('click', () => {
  copyModal.classList.add('hidden');
});

copyConfirmBtn.addEventListener('click', async () => {
  const mode = document.querySelector('input[name="copyMode"]:checked').value;
  copyConfirmBtn.disabled = true;
  copyConfirmBtn.textContent = 'Copying…';
  try {
    if (mode === 'favourites') {
      await copyFavourites();
    } else {
      await copyFromLastWeek(mode);
    }
    copyModal.classList.add('hidden');
    await loadDay();
  } catch (err) {
    showToast('Copy failed: ' + err.message);
  } finally {
    copyConfirmBtn.disabled = false;
    copyConfirmBtn.textContent = 'Copy';
  }
});

async function copyFromLastWeek(mode) {
  const memberId = await getMemberId();

  const lastWeekStart = addDays(getWeekStart(currentDate), -7);
  const lastWeekEnd = addDays(lastWeekStart, 6);
  const lastWeekResponse = await listTimeEntries({
    memberId,
    dateOnOrAfter: formatDate(lastWeekStart),
    dateOnOrBefore: formatDate(lastWeekEnd),
  });
  const lastWeekEntries = (lastWeekResponse.results || []).filter(
    (e) => e.date >= formatDate(lastWeekStart) && e.date <= formatDate(lastWeekEnd)
  );

  if (lastWeekEntries.length === 0) {
    showToast('No entries found in last week');
    return;
  }

  // Fetch current week to avoid duplicates
  const thisWeekStart = getWeekStart(currentDate);
  const thisWeekEnd = addDays(thisWeekStart, 6);
  const thisWeekResponse = await listTimeEntries({
    memberId,
    dateOnOrAfter: formatDate(thisWeekStart),
    dateOnOrBefore: formatDate(thisWeekEnd),
  });
  const existingKeys = new Set(
    (thisWeekResponse.results || []).map((e) => `${e.date}::${e.project?.id || ''}::${e.task?.id || ''}`)
  );

  const today = formatDate(currentDate);
  let entriesToCreate;

  if (mode === 'whole-week') {
    // Copy each entry to the same weekday this week
    entriesToCreate = lastWeekEntries
      .map((e) => ({
        date: formatDate(addDays(new Date(e.date + 'T00:00:00'), 7)),
        projectId: e.project?.id,
        taskId: e.task?.id || null,
        roleId: e.role?.id || null,
        notes: e.notes || '',
      }))
      .filter((e) => e.projectId && !existingKeys.has(`${e.date}::${e.projectId}::${e.taskId || ''}`));
  } else if (mode === 'today-only') {
    // Copy last week's same weekday entries to today
    const lastWeekSameDay = formatDate(addDays(currentDate, -7));
    const sameDayEntries = lastWeekEntries.filter((e) => e.date === lastWeekSameDay);
    if (sameDayEntries.length === 0) {
      showToast('No entries found for last week\'s same day');
      return;
    }
    entriesToCreate = sameDayEntries
      .map((e) => ({
        date: today,
        projectId: e.project?.id,
        taskId: e.task?.id || null,
        roleId: e.role?.id || null,
        notes: e.notes || '',
      }))
      .filter((e) => e.projectId && !existingKeys.has(`${today}::${e.projectId}::${e.taskId || ''}`));
  } else {
    // all-to-today — unique project+task combos from all last week to today
    const seen = new Set();
    entriesToCreate = [];
    for (const e of lastWeekEntries) {
      const projectId = e.project?.id;
      if (!projectId) continue;
      const taskId = e.task?.id || null;
      const comboKey = `${projectId}::${taskId || ''}`;
      if (seen.has(comboKey)) continue;
      seen.add(comboKey);
      if (existingKeys.has(`${today}::${projectId}::${taskId || ''}`)) continue;
      entriesToCreate.push({
        date: today,
        projectId,
        taskId,
        roleId: e.role?.id || null,
        notes: e.notes || '',
      });
    }
  }

  if (entriesToCreate.length === 0) {
    showToast('All entries already exist for this period', 'success');
    return;
  }

  let created = 0;
  let skipped = 0;
  for (const entry of entriesToCreate) {
    const data = {
      typeId: 'project_time',
      projectId: entry.projectId,
      date: entry.date,
      minutes: 0,
      notes: entry.notes,
      memberId,
    };
    if (entry.taskId) data.taskId = entry.taskId;
    if (entry.roleId) data.roleId = entry.roleId;
    try {
      await createTimeEntry(data);
      created++;
    } catch {
      skipped++;
    }
  }

  const skippedMsg = skipped > 0 ? ` (${skipped} skipped — archived task)` : '';
  showToast(`${created} ${created === 1 ? 'entry' : 'entries'} copied${skippedMsg}`, 'success');
  trackEvent('copy_over', { mode, count: created });
}

async function copyFavourites() {
  const favKeys = await getFavouriteProjects();
  if (!favKeys || favKeys.length === 0) {
    showToast('No favourite projects saved');
    return;
  }
  const memberId = await getMemberId();
  const today = formatDate(currentDate);
  const todayResponse = await listTimeEntries({ memberId, dateOnOrAfter: today, dateOnOrBefore: today });
  const existingKeys = new Set(
    (todayResponse.results || [])
      .filter((e) => e.date === today)
      .map((e) => `${e.project?.id}::${e.task?.id || ''}`)
  );
  const toCreate = favKeys.filter((key) => {
    const [projectId, taskId] = key.split('::');
    return !existingKeys.has(`${projectId}::${taskId}`);
  });
  if (toCreate.length === 0) {
    showToast('All favourites already have entries today', 'success');
    return;
  }
  let created = 0;
  let skipped = 0;
  for (const key of toCreate) {
    const [projectId, taskId, roleId] = key.split('::');
    const data = { typeId: 'project_time', projectId, date: today, minutes: 0, notes: '', memberId };
    if (taskId) data.taskId = taskId;
    if (roleId) data.roleId = roleId;
    try {
      await createTimeEntry(data);
      created++;
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('notes')) {
        try {
          await createTimeEntry({ ...data, notes: 'Add notes' });
          created++;
        } catch {
          skipped++;
        }
      } else {
        skipped++;
      }
    }
  }
  const skippedMsg = skipped > 0 ? ` (${skipped} skipped)` : '';
  showToast(`${created} ${created === 1 ? 'entry' : 'entries'} added${skippedMsg}`, 'success');
  trackEvent('copy_favourites', { count: created });
}

// --- Reload on focus: reset to today, pick up changes from other clients (debounced 30s) ---
window.addEventListener('focus', () => {
  if (!weeklyView.classList.contains('hidden') && Date.now() - lastLoadAt > 30000) {
    currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    loadDay();
  }
});

// --- Start ---
init();
