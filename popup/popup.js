import { getMemberId, setMemberId, getLastUsedProjectId, setLastUsedProjectId, getLastUsedTaskId, setLastUsedTaskId, addRecentProject, getTimerState, setTimerState, clearTimerState } from '../lib/storage.js';
import { listTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry, listProjectMembers, listProjectTasks, listMembers } from '../lib/api.js';

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

// --- DOM refs ---
const setupView = document.getElementById('setupView');
const weeklyView = document.getElementById('weeklyView');
const entryView = document.getElementById('entryView');
const setupEmail = document.getElementById('setupEmail');
const setupStatus = document.getElementById('setupStatus');
const openLoginBtn = document.getElementById('openLoginBtn');
const settingsBtn = document.getElementById('settingsBtn');
const prevDayBtn = document.getElementById('prevDay');
const nextDayBtn = document.getElementById('nextDay');
const currentDayLabel = document.getElementById('currentDayLabel');
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
        await startAppView();
        return;
      }
    }
    showSetupView();
    return;
  }

  await startAppView();
}

async function startAppView() {
  stopLoginPolling();
  showView(weeklyView);
  await loadDay();
}

function showSetupView() {
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
      setStatus(setupStatus, 'Still not linked. You can retry or change email.', 'error');
      return;
    }
    const loggedIn = await isRuddrLoggedIn();
    if (!loggedIn) return;
    const linked = await attemptLinkMemberFromPendingEmail();
    if (linked) {
      await startAppView();
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

// --- Day View ---
async function loadDay() {
  lastLoadAt = Date.now();
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
    renderDay();
    initTimerBar();
  } catch (err) {
    dayContainer.innerHTML = `<div class="empty-state">Failed to load entries.<br><small>${err.message}</small></div>`;
  }
  loadWeekStatus(); // non-awaited: updates week bar independently
}

function updateDayLabel() {
  if (isToday(currentDate)) {
    currentDayLabel.textContent = 'Today';
  } else {
    currentDayLabel.textContent = formatDayLabel(currentDate);
  }
}

function renderDay() {
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
        totalMinutes: 0,
        entries: [],
      };
      groups.push(groupMap[key]);
    }

    groupMap[key].totalMinutes += (e.minutes || 0);
    groupMap[key].entries.push(e);
  });

  const dayTotal = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);

  let html = '<div class="day-entries">';

  groups.forEach((g) => {
    // Use the first entry for click-to-edit and play button
    const firstEntry = g.entries[0];
    const notes = g.entries.map((e) => e.notes).filter(Boolean);
    const uniqueNotes = [...new Set(notes)];
    const detail = [g.taskName, ...uniqueNotes].filter(Boolean).join(' \u00b7 ');

    html += `<div class="entry-item" data-id="${firstEntry.id}">
      <div class="entry-info">
        <div class="entry-project">${escapeHtml(g.projectName)}</div>
        ${detail ? `<div class="entry-detail">${escapeHtml(detail)}</div>` : ''}
      </div>
      <span class="entry-hours">${minutesToHours(g.totalMinutes)}h</span>
      <button class="entry-play-btn" data-id="${firstEntry.id}" title="Start timer">&#9654;</button>
    </div>`;
  });

  html += '</div>';

  dayContainer.innerHTML = html;
  dailyTotalEl.textContent = minutesToHours(dayTotal) + 'h';

  // Attach click handlers for entries
  dayContainer.querySelectorAll('.entry-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.entry-play-btn')) return;
      const entry = entries.find((en) => en.id === el.dataset.id);
      if (entry) openEntryForm(entry);
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

  // Populate project dropdown (already sorted alphabetically)
  projectSelect.innerHTML = '<option value="">Select project...</option>';
  projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    const clientLabel = p.clientName ? ` (${p.clientName})` : '';
    opt.textContent = p.name + clientLabel;
    projectSelect.appendChild(opt);
  });

  // Reset task/role dropdowns
  taskSelect.innerHTML = '<option value="">Select task...</option>';
  taskSelect.disabled = true;
  roleSelect.innerHTML = '<option value="">Select role...</option>';
  roleSelect.disabled = true;

  if (entry) {
    // Fill form with existing entry
    projectSelect.value = entry.project?.id || '';
    entryDate.value = entry.date;
    entryHours.value = minutesToHours(entry.minutes);
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
    await loadDay();
  } catch (err) {
    showToast('Failed to stop timer: ' + err.message);
  }
  timerStopBtn.disabled = false;
}

// --- Event Listeners ---

openLoginBtn.addEventListener('click', () => {
  const email = setupEmail.value.trim();
  if (!email) {
    setStatus(setupStatus, 'Please enter your email first.', 'error');
    return;
  }
  chrome.storage.local.set({ pendingEmail: email });
  setStatus(setupStatus, 'Opening Ruddr login...', 'success');
  stopLoginPolling();
  startLoginPolling();
  chrome.tabs.create({ url: 'https://www.ruddr.io/login' });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

prevDayBtn.addEventListener('click', () => {
  currentDate = addDays(currentDate, -1);
  loadDay();
});

nextDayBtn.addEventListener('click', () => {
  currentDate = addDays(currentDate, 1);
  loadDay();
});

currentDayLabel.addEventListener('click', () => {
  currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  loadDay();
});

addEntryBtn.addEventListener('click', () => openEntryForm());

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
    } else {
      const toUnsubmit = weekEntries.filter((e) => e.statusId === 'pending_approval');
      await Promise.all(toUnsubmit.map((e) => updateTimeEntry(e.id, { statusId: 'not_submitted', notes: e.notes || '' })));
      showToast('Timesheet unsubmitted', 'success');
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
    } else {
      await createTimeEntry(data);
      showToast('Entry created', 'success');
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
