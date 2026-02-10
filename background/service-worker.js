const BASE_URL = 'https://www.ruddr.io/api/workspace';
const API_KEY = 'QlKTlnnk98UsRyFLd08KGoZwxOoYNLJZpBGPevZ6pmKjEDJztSPAjaWXWGxhfqB6qdoAcnpeflCv3z5DpVBPvhVXxMi7SgvmkegM';

// --- Install & Startup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('updateBadge', { periodInMinutes: 30 });
  updateBadge();
  setupReminderAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  // Restore timer tick if timer was running
  const { timerState } = await chrome.storage.local.get('timerState');
  if (timerState && timerState.running) {
    chrome.alarms.create('timerTick', { periodInMinutes: 1 });
    updateTimerBadge(timerState);
  }
  setupReminderAlarms();
});

// --- Alarm Listener ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateBadge') {
    updateBadge();
  } else if (alarm.name === 'timerTick') {
    handleTimerTick();
  } else if (alarm.name === 'reminderEndOfDay') {
    handleEndOfDayReminder();
  } else if (alarm.name === 'reminderPeriodic') {
    handlePeriodicReminder();
  }
});

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'timerStarted') {
    chrome.alarms.create('timerTick', { periodInMinutes: 1 });
    // Immediately update badge
    chrome.storage.local.get('timerState', ({ timerState }) => {
      if (timerState) updateTimerBadge(timerState);
    });
  } else if (message.type === 'timerStopped') {
    chrome.alarms.clear('timerTick');
    chrome.storage.local.remove('lastTimerReminder');
    updateBadge();
  } else if (message.type === 'updateReminders') {
    setupReminderAlarms();
  }
});

// --- Timer Badge ---
const TIMER_CHECK_INTERVAL_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours

async function handleTimerTick() {
  const { timerState, lastTimerReminder } = await chrome.storage.local.get(['timerState', 'lastTimerReminder']);
  if (timerState && timerState.running) {
    updateTimerBadge(timerState);

    // Check if timer has been running long enough to nudge
    const elapsedMs = Date.now() - timerState.startedAt;
    const lastReminder = lastTimerReminder || timerState.startedAt;
    const sinceLast = Date.now() - lastReminder;

    if (elapsedMs >= TIMER_CHECK_INTERVAL_MS && sinceLast >= TIMER_CHECK_INTERVAL_MS) {
      const h = Math.floor(elapsedMs / 3600000);
      const m = Math.floor((elapsedMs % 3600000) / 60000);
      chrome.notifications.create('timerCheck', {
        type: 'basic',
        iconUrl: '../icons/icon128.png',
        title: 'Timer Still Running',
        message: `Your timer has been running for ${h}h ${m}m. Is it still going?`,
      });
      await chrome.storage.local.set({ lastTimerReminder: Date.now() });
    }
  } else {
    chrome.alarms.clear('timerTick');
    await chrome.storage.local.remove('lastTimerReminder');
    updateBadge();
  }
}

function updateTimerBadge(timerState) {
  const elapsedMs = Date.now() - timerState.startedAt;
  const accumulated = (timerState.accumulatedMinutes || 0);
  const totalMinutes = Math.floor(elapsedMs / 60000) + accumulated;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const text = `${h}:${String(m).padStart(2, '0')}`;

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#0bb5ac' }); // teal
}

// --- Normal Badge ---
async function updateBadge() {
  // Only show badge when timer is running
  const { timerState } = await chrome.storage.local.get('timerState');
  if (timerState && timerState.running) {
    updateTimerBadge(timerState);
    return;
  }

  // No timer running — clear badge
  chrome.action.setBadgeText({ text: '' });
}

// --- Reminder Alarms ---
async function setupReminderAlarms() {
  // Clear existing reminder alarms
  await chrome.alarms.clear('reminderEndOfDay');
  await chrome.alarms.clear('reminderPeriodic');

  const { reminderSettings } = await chrome.storage.local.get('reminderSettings');
  const settings = reminderSettings || {
    endOfDay: true,
    endOfDayTime: '17:00',
    endOfDayMinHours: 7,
    periodic: true,
    periodicInterval: 2,
    workStart: '09:00',
    workEnd: '17:00',
  };

  if (settings.endOfDay) {
    // Schedule end-of-day alarm
    const [hours, minutes] = settings.endOfDayTime.split(':').map(Number);
    const now = new Date();
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);

    // If the time already passed today, schedule for tomorrow
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const delayMs = target.getTime() - now.getTime();
    chrome.alarms.create('reminderEndOfDay', {
      delayInMinutes: delayMs / 60000,
      periodInMinutes: 24 * 60, // repeat daily
    });
  }

  if (settings.periodic) {
    chrome.alarms.create('reminderPeriodic', {
      delayInMinutes: settings.periodicInterval * 60,
      periodInMinutes: settings.periodicInterval * 60,
    });
  }
}

// --- End-of-Day Reminder ---
async function handleEndOfDayReminder() {
  const { reminderSettings } = await chrome.storage.local.get('reminderSettings');
  const settings = reminderSettings || { endOfDayMinHours: 7 };

  try {
    const { memberId } = await chrome.storage.local.get(['memberId']);
    if (!memberId) return;

    const today = new Date().toISOString().split('T')[0];
    const params = new URLSearchParams({
      memberId,
      dateOnOrAfter: today,
      dateOnOrBefore: today,
      limit: '100',
    });

    const response = await fetch(`${BASE_URL}/time-entries?${params}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });

    if (!response.ok) return;

    const data = await response.json();
    const entries = data.results || [];
    const totalMinutes = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);

    if (totalMinutes < (settings.endOfDayMinHours || 7) * 60) {
      chrome.notifications.create('endOfDay', {
        type: 'basic',
        iconUrl: '../icons/icon128.png',
        title: 'Ruddr Time Reminder',
        message: `You've logged ${totalHours}h today. Don't forget to complete your timesheet!`,
      });
    }
  } catch {
    // Silently fail
  }
}

// --- Periodic Reminder ---
async function handlePeriodicReminder() {
  const { reminderSettings } = await chrome.storage.local.get('reminderSettings');
  const settings = reminderSettings || { workStart: '09:00', workEnd: '17:00' };

  // Check if it's a weekday
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return; // Skip weekends

  // Check if within work hours
  const [startH, startM] = (settings.workStart || '09:00').split(':').map(Number);
  const [endH, endM] = (settings.workEnd || '17:00').split(':').map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const workStartMinutes = startH * 60 + startM;
  const workEndMinutes = endH * 60 + endM;

  if (currentMinutes < workStartMinutes || currentMinutes > workEndMinutes) return;

  try {
    const { memberId } = await chrome.storage.local.get(['memberId']);
    if (!memberId) return;

    const today = now.toISOString().split('T')[0];
    const params = new URLSearchParams({
      memberId,
      dateOnOrAfter: today,
      dateOnOrBefore: today,
      limit: '100',
    });

    const response = await fetch(`${BASE_URL}/time-entries?${params}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });

    if (!response.ok) return;

    const data = await response.json();
    const entries = data.results || [];
    const totalMinutes = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);

    chrome.notifications.create('periodic', {
      type: 'basic',
      iconUrl: '../icons/icon128.png',
      title: 'Time Check',
      message: `You've logged ${totalHours}h so far today.`,
    });
  } catch {
    // Silently fail
  }
}

// --- Notification Click ---
chrome.notifications.onClicked.addListener(() => {
  // Try to open the popup; fall back to focusing the extension
  try {
    chrome.action.openPopup();
  } catch {
    // openPopup may not be available in all contexts
  }
});
