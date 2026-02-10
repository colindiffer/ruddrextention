import { getMemberId, getLastUsedProjectId, setLastUsedProjectId, getLastUsedTaskId, setLastUsedTaskId, addRecentProject, getTimerState, setTimerState, clearTimerState } from '../lib/storage.js';
import { listTimeEntries, createTimeEntry, updateTimeEntry, deleteTimeEntry, listProjectMembers, listProjectTasks, getTimeEntry } from '../lib/api.js';

// --- State ---
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
let entries = [];
let projects = []; // { id, name, clientName } sorted alphabetically
let memberProjectMap = {}; // projectId -> project-member record (includes roles)
let editingEntry = null; // null = new, object = editing
let timerInterval = null; // setInterval handle for live timer display

// --- DOM refs ---
const setupView = document.getElementById('setupView');
const weeklyView = document.getElementById('weeklyView');
const entryView = document.getElementById('entryView');
const openOptionsBtn = document.getElementById('openOptionsBtn');
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

function showToast(message, type = 'error') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
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

// --- Timer Display ---
async function initTimerBar() {
  const state = await getTimerState();
  if (state && state.running) {
    showTimerBar(state, 'running');
    startTimerTick(state);
  } else if (state && state.paused) {
    showTimerBar(state, 'paused');
  } else {
    timerBar.classList.add('hidden');
  }
}

function showTimerBar(state, mode) {
  timerBar.classList.remove('hidden', 'paused');
  const project = projects.find((p) => p.id === state.projectId);
  timerProject.textContent = project ? project.name : (state.projectName || 'Timer');

  if (mode === 'running') {
    updateTimerDisplay(state);
    timerStopBtn.classList.remove('hidden');
    timerResumeBtn.classList.add('hidden');
    timerDismissBtn.classList.add('hidden');
  } else {
    // Paused
    timerBar.classList.add('paused');
    timerDisplay.textContent = formatElapsedMinutes(state.accumulatedMinutes || 0);
    timerStopBtn.classList.add('hidden');
    timerResumeBtn.classList.remove('hidden');
    timerDismissBtn.classList.remove('hidden');
  }
}

function updateTimerDisplay(state) {
  const elapsedMs = Date.now() - state.startedAt;
  const accMs = (state.accumulatedMinutes || 0) * 60000;
  timerDisplay.textContent = formatElapsed(elapsedMs + accMs);
}

function formatElapsedMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')}:00`;
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
  const memberId = await getMemberId();

  if (!memberId) {
    showView(setupView);
    return;
  }

  showView(weeklyView);
  await loadDay();
  await initTimerBar();
}

// --- Day View ---
async function loadDay() {
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
  } catch (err) {
    dayContainer.innerHTML = `<div class="empty-state">Failed to load entries.<br><small>${err.message}</small></div>`;
  }
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
    dayContainer.innerHTML = '<div class="empty-state">No entries today.<br>Click "+ New Entry" to add one.</div>';
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
        entryIds: [],
        entries: [],
      };
      groups.push(groupMap[key]);
    }

    groupMap[key].totalMinutes += (e.minutes || 0);
    groupMap[key].entryIds.push(e.id);
    groupMap[key].entries.push(e);
  });

  const dayTotal = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);

  let html = '<div class="day-entries">';

  groups.forEach((g) => {
    // Use the first entry for click-to-edit and play button
    const firstEntry = g.entries[0];
    const notes = g.entries.map((e) => e.notes).filter(Boolean);
    const uniqueNotes = [...new Set(notes)];
    const detail = [g.taskName, ...uniqueNotes].filter(Boolean).join(' · ');

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
  const currentState = await getTimerState();
  if (currentState && currentState.running) {
    await pauseTimer();
  }
  const afterPause = await getTimerState();
  if (afterPause && afterPause.paused) {
    await clearTimerState();
  }

  const startedAt = Date.now();
  try {
    let apiTimer = false;
    try {
      await updateTimeEntry(entry.id, { timerStartedAt: new Date().toISOString() });
      apiTimer = true;
    } catch {
      // API doesn't support timerStartedAt, use local
    }

    const timerState = {
      running: true,
      paused: false,
      entryId: entry.id,
      projectId: entry.project?.id || '',
      projectName: entry.project?.name || '',
      taskId: entry.task?.id || null,
      roleId: entry.role?.id || null,
      notes: entry.notes || '',
      startedAt,
      accumulatedMinutes: entry.minutes || 0,
      apiTimer,
    };
    await setTimerState(timerState);
    chrome.runtime.sendMessage({ type: 'timerStarted' });

    showTimerBar(timerState, 'running');
    startTimerTick(timerState);
    showToast('Timer started', 'success');
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

  // If a timer is already running, pause it first
  const currentState = await getTimerState();
  if (currentState && currentState.running) {
    await pauseTimer();
  }
  // Dismiss any paused timer silently
  const afterPause = await getTimerState();
  if (afterPause && afterPause.paused) {
    await clearTimerState();
  }

  startTimerSubmitBtn.disabled = true;

  const memberId = await getMemberId();
  const project = projects.find((p) => p.id === projectId);
  const startedAt = Date.now();
  const today = formatDate(new Date());

  // If editing an existing entry, start timer on that entry
  // Otherwise check for existing entry today with same project+task
  const targetEntry = editingEntry || entries.find((e) =>
    e.date === today &&
    e.project?.id === projectId &&
    (e.task?.id || null) === taskId
  );

  try {
    if (targetEntry) {
      // Start timer on existing entry
      let apiTimer = false;
      try {
        await updateTimeEntry(targetEntry.id, { timerStartedAt: new Date().toISOString() });
        apiTimer = true;
      } catch {
        // API doesn't support timerStartedAt, use local
      }

      const timerState = {
        running: true,
        paused: false,
        entryId: targetEntry.id,
        projectId,
        projectName: project?.name || '',
        taskId,
        roleId,
        notes: targetEntry.notes || notes,
        startedAt,
        accumulatedMinutes: targetEntry.minutes || 0,
        apiTimer,
      };
      await setTimerState(timerState);
    } else {
      // Create a new entry
      const data = {
        typeId: 'project_time',
        projectId,
        memberId,
        date: today,
        minutes: 1,
        notes,
      };
      if (taskId) data.taskId = taskId;
      if (roleId) data.roleId = roleId;

      let apiTimer = false;
      let created;
      try {
        data.timerStartedAt = new Date().toISOString();
        created = await createTimeEntry(data);
        apiTimer = true;
      } catch {
        delete data.timerStartedAt;
        created = await createTimeEntry(data);
      }

      const timerState = {
        running: true,
        paused: false,
        entryId: created.id,
        projectId,
        projectName: project?.name || '',
        taskId,
        roleId,
        notes,
        startedAt,
        accumulatedMinutes: 0,
        apiTimer,
      };
      await setTimerState(timerState);
    }

    await setLastUsedProjectId(projectId);
    if (taskId) await setLastUsedTaskId(taskId);
    if (project) await addRecentProject({ id: project.id, name: project.name, clientName: project.clientName });

    chrome.runtime.sendMessage({ type: 'timerStarted' });

    const state = await getTimerState();
    showView(weeklyView);
    showTimerBar(state, 'running');
    startTimerTick(state);
    showToast('Timer started', 'success');
    await loadDay();
  } catch (err) {
    showToast('Failed to start timer: ' + err.message);
  }

  startTimerSubmitBtn.disabled = false;
}

// --- Timer Pause ---
async function pauseTimer() {
  const state = await getTimerState();
  if (!state || !state.running) return;

  timerStopBtn.disabled = true;
  const elapsedMs = Date.now() - state.startedAt;
  const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60000));
  const totalAccumulated = (state.accumulatedMinutes || 0) + elapsedMinutes;

  try {
    if (state.apiTimer && state.entryId) {
      // Pause API timer: clear timerStartedAt, API calculates minutes
      await updateTimeEntry(state.entryId, { timerStartedAt: null });
      // Fetch entry to get actual accumulated minutes from API
      try {
        const entry = await getTimeEntry(state.entryId);
        if (entry && entry.minutes != null) {
          // Use API's calculated total
          const pausedState = {
            ...state,
            running: false,
            paused: true,
            accumulatedMinutes: entry.minutes,
            startedAt: null,
          };
          await setTimerState(pausedState);
          showTimerBar(pausedState, 'paused');
          showToast(`Timer paused — ${minutesToHours(entry.minutes)}h so far`, 'success');
          stopTimerTick();
          timerStopBtn.disabled = false;
          chrome.runtime.sendMessage({ type: 'timerStopped' });
          await loadDay();
          return;
        }
      } catch {
        // Fall through to use local calculation
      }
    } else if (!state.entryId) {
      // Local timer, first pause: create the entry now
      const memberId = await getMemberId();
      const data = {
        typeId: 'project_time',
        projectId: state.projectId,
        memberId,
        date: formatDate(new Date()),
        minutes: totalAccumulated,
        notes: state.notes || '',
      };
      if (state.taskId) data.taskId = state.taskId;
      if (state.roleId) data.roleId = state.roleId;
      const created = await createTimeEntry(data);
      state.entryId = created.id;
    } else {
      // Local timer with existing entry: update minutes
      await updateTimeEntry(state.entryId, { minutes: totalAccumulated });
    }

    const pausedState = {
      ...state,
      running: false,
      paused: true,
      accumulatedMinutes: totalAccumulated,
      startedAt: null,
    };
    await setTimerState(pausedState);
    showTimerBar(pausedState, 'paused');
    showToast(`Timer paused — ${minutesToHours(totalAccumulated)}h so far`, 'success');
  } catch (err) {
    showToast('Failed to pause timer: ' + err.message);
  }

  stopTimerTick();
  timerStopBtn.disabled = false;
  chrome.runtime.sendMessage({ type: 'timerStopped' });
  await loadDay();
}

// --- Timer Resume ---
async function resumeTimer() {
  const state = await getTimerState();
  if (!state || !state.paused) return;

  timerResumeBtn.disabled = true;
  const startedAt = Date.now();

  try {
    if (state.apiTimer && state.entryId) {
      // Resume API timer: set timerStartedAt again
      await updateTimeEntry(state.entryId, { timerStartedAt: new Date().toISOString() });
    }

    const runningState = {
      ...state,
      running: true,
      paused: false,
      startedAt,
    };
    await setTimerState(runningState);

    chrome.runtime.sendMessage({ type: 'timerStarted' });

    showTimerBar(runningState, 'running');
    startTimerTick(runningState);
    showToast('Timer resumed', 'success');
  } catch (err) {
    showToast('Failed to resume timer: ' + err.message);
  }

  timerResumeBtn.disabled = false;
}

// --- Timer Dismiss ---
async function dismissTimer() {
  await clearTimerState();
  stopTimerTick();
  timerBar.classList.add('hidden');
  chrome.runtime.sendMessage({ type: 'timerStopped' });
  showToast('Timer dismissed', 'success');
}

// --- Event Listeners ---

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
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

timerStopBtn.addEventListener('click', pauseTimer);
timerResumeBtn.addEventListener('click', resumeTimer);
timerDismissBtn.addEventListener('click', dismissTimer);

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

// --- Start ---
init();
