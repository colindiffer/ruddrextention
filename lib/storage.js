// URL of the deployed GCP Cloud Function — update after deployment
const CLOUD_FUNCTION_URL = 'https://europe-west2-ruddr-reporting.cloudfunctions.net/getRuddrApiKey';
// Shared secret — must match the SHARED_SECRET env var set on the Cloud Function
const SHARED_SECRET = '0b62f8e167ae0e7b5019c994be1b9003052fbda661c17776dd59deb84d03ab74';
const KEY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export function getApiKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('apiKeyCache', async (result) => {
      const cache = result.apiKeyCache;
      const now = Date.now();

      // Return cached key if still fresh
      if (cache && cache.key && (now - cache.fetchedAt) < KEY_CACHE_TTL) {
        resolve(cache.key);
        return;
      }

      // Fetch from Cloud Function
      try {
        const response = await fetch(CLOUD_FUNCTION_URL, {
          headers: { 'Authorization': `Bearer ${SHARED_SECRET}` },
        });

        if (!response.ok) throw new Error(`Key fetch failed (${response.status})`);

        const { key } = await response.json();
        await chrome.storage.local.set({ apiKeyCache: { key, fetchedAt: now } });
        resolve(key);
      } catch (err) {
        // Fall back to stale cache rather than breaking for the user
        if (cache && cache.key) {
          resolve(cache.key);
        } else {
          reject(new Error('Unable to retrieve API key. Check your connection.'));
        }
      }
    });
  });
}

export function setApiKey() {
  // Key is managed via GCP — this is intentionally a no-op
  return Promise.resolve();
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
