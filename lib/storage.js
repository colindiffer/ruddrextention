// Hardcoded workspace API key
const API_KEY = 'QlKTlnnk98UsRyFLd08KGoZwxOoYNLJZpBGPevZ6pmKjEDJztSPAjaWXWGxhfqB6qdoAcnpeflCv3z5DpVBPvhVXxMi7SgvmkegM';

export function getApiKey() {
  return Promise.resolve(API_KEY);
}

export function getMemberId() {
  return new Promise((resolve) => {
    chrome.storage.local.get('memberId', (result) => resolve(result.memberId || ''));
  });
}

export function setMemberId(id) {
  return chrome.storage.local.set({ memberId: id });
}

export function getMemberName() {
  return new Promise((resolve) => {
    chrome.storage.local.get('memberName', (result) => resolve(result.memberName || ''));
  });
}

export function setMemberName(name) {
  return chrome.storage.local.set({ memberName: name });
}

export function getRecentProjects() {
  return new Promise((resolve) => {
    chrome.storage.local.get('recentProjects', (result) => resolve(result.recentProjects || []));
  });
}

export async function addRecentProject(project) {
  const recent = await getRecentProjects();
  const filtered = recent.filter((p) => p.id !== project.id);
  filtered.unshift({ id: project.id, name: project.name, clientName: project.clientName });
  const trimmed = filtered.slice(0, 5);
  return chrome.storage.local.set({ recentProjects: trimmed });
}

export function getLastUsedProjectId() {
  return new Promise((resolve) => {
    chrome.storage.local.get('lastProjectId', (result) => resolve(result.lastProjectId || ''));
  });
}

export function setLastUsedProjectId(id) {
  return chrome.storage.local.set({ lastProjectId: id });
}

export function getLastUsedTaskId() {
  return new Promise((resolve) => {
    chrome.storage.local.get('lastTaskId', (result) => resolve(result.lastTaskId || ''));
  });
}

export function setLastUsedTaskId(id) {
  return chrome.storage.local.set({ lastTaskId: id });
}

// --- Timer State ---
export function getTimerState() {
  return new Promise((resolve) => {
    chrome.storage.local.get('timerState', (result) => resolve(result.timerState || null));
  });
}

export function setTimerState(state) {
  return chrome.storage.local.set({ timerState: state });
}

export function clearTimerState() {
  return chrome.storage.local.remove('timerState');
}

// --- Reminder Settings ---
const DEFAULT_REMINDER_SETTINGS = {
  endOfDay: true,
  endOfDayTime: '17:00',
  endOfDayMinHours: 7,
  periodic: true,
  periodicInterval: 2,
  workStart: '09:00',
  workEnd: '17:00',
};

export function getReminderSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('reminderSettings', (result) => {
      resolve(result.reminderSettings || DEFAULT_REMINDER_SETTINGS);
    });
  });
}

export function setReminderSettings(settings) {
  return chrome.storage.local.set({ reminderSettings: settings });
}
