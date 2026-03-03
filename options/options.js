import { getReminderSettings, setReminderSettings } from '../lib/storage.js';
import { trackEvent, trackView } from '../lib/analytics.js';

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

// --- Status helper ---
function setStatus(el, message, type = '') {
  el.textContent = message;
  el.className = `status-msg ${type}`;
}

// --- Init ---
async function init() {
  trackView('Settings');
  await loadReminderSettings();
}

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

  trackEvent('options_save', { type: 'reminders' });
  setStatus(reminderSaveStatus, 'Saved!', 'success');
  showToast('Reminder settings saved', 'success');
});

init();
