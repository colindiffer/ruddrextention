import { getMemberId, setMemberId, setMemberName, getReminderSettings, setReminderSettings } from '../lib/storage.js';
import { listMembers } from '../lib/api.js';

// --- Login elements ---
const emailInput = document.getElementById('emailInput');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');
const loggedOutState = document.getElementById('loggedOutState');
const loggedInState = document.getElementById('loggedInState');
const loggedInName = document.getElementById('loggedInName');
const loggedInEmail = document.getElementById('loggedInEmail');
const logoutBtn = document.getElementById('logoutBtn');

// --- Reminder elements ---
const endOfDayEnabled = document.getElementById('endOfDayEnabled');
const endOfDayTime = document.getElementById('endOfDayTime');
const endOfDayMinHours = document.getElementById('endOfDayMinHours');
const endOfDayOptions = document.getElementById('endOfDayOptions');
const periodicEnabled = document.getElementById('periodicEnabled');
const periodicInterval = document.getElementById('periodicInterval');
const workStart = document.getElementById('workStart');
const workEnd = document.getElementById('workEnd');
const periodicOptions = document.getElementById('periodicOptions');
const saveRemindersBtn = document.getElementById('saveRemindersBtn');
const reminderSaveStatus = document.getElementById('reminderSaveStatus');

function showToast(message, type = 'error') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function setStatus(el, message, type) {
  el.textContent = message;
  el.className = `status-msg ${type}`;
}

// --- Init ---
async function init() {
  const memberId = await getMemberId();
  if (memberId) {
    // Already logged in — show logged-in state
    const { memberEmail, memberName } = await chrome.storage.local.get(['memberEmail', 'memberName']);
    showLoggedIn(memberName || 'Member', memberEmail || '');
  }

  await loadReminderSettings();
}

// --- Login ---
function showLoggedIn(name, email) {
  loggedOutState.classList.add('hidden');
  loggedInState.classList.remove('hidden');
  loggedInName.textContent = name;
  loggedInEmail.textContent = email;
}

function showLoggedOut() {
  loggedOutState.classList.remove('hidden');
  loggedInState.classList.add('hidden');
  emailInput.value = '';
  setStatus(loginStatus, '', '');
}

loginBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim().toLowerCase();
  if (!email) {
    setStatus(loginStatus, 'Please enter your email', 'error');
    return;
  }

  loginBtn.disabled = true;
  setStatus(loginStatus, 'Signing in...', '');

  try {
    const members = await listMembers();
    const match = members.find((m) =>
      (m.email || '').toLowerCase() === email
    );

    if (!match) {
      setStatus(loginStatus, 'No account found for that email', 'error');
      return;
    }

    await setMemberId(match.id);
    await setMemberName(match.name);
    await chrome.storage.local.set({ memberEmail: email });

    showLoggedIn(match.name, email);
    showToast(`Signed in as ${match.name}`, 'success');
  } catch (err) {
    setStatus(loginStatus, 'Sign in failed: ' + err.message, 'error');
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['memberId', 'memberName', 'memberEmail']);
  showLoggedOut();
  showToast('Signed out', 'success');
});

// --- Reminder Settings ---
async function loadReminderSettings() {
  const settings = await getReminderSettings();

  endOfDayEnabled.checked = settings.endOfDay;
  endOfDayTime.value = settings.endOfDayTime;
  endOfDayMinHours.value = settings.endOfDayMinHours;
  periodicEnabled.checked = settings.periodic;
  periodicInterval.value = settings.periodicInterval;
  workStart.value = settings.workStart;
  workEnd.value = settings.workEnd;

  toggleSubOptions();
}

function toggleSubOptions() {
  endOfDayOptions.style.display = endOfDayEnabled.checked ? 'block' : 'none';
  periodicOptions.style.display = periodicEnabled.checked ? 'block' : 'none';
}

endOfDayEnabled.addEventListener('change', toggleSubOptions);
periodicEnabled.addEventListener('change', toggleSubOptions);

saveRemindersBtn.addEventListener('click', async () => {
  const settings = {
    endOfDay: endOfDayEnabled.checked,
    endOfDayTime: endOfDayTime.value,
    endOfDayMinHours: parseFloat(endOfDayMinHours.value) || 7,
    periodic: periodicEnabled.checked,
    periodicInterval: parseFloat(periodicInterval.value) || 2,
    workStart: workStart.value,
    workEnd: workEnd.value,
  };

  await setReminderSettings(settings);
  chrome.runtime.sendMessage({ type: 'updateReminders' });

  setStatus(reminderSaveStatus, 'Saved!', 'success');
  showToast('Reminder settings saved', 'success');
});

init();
