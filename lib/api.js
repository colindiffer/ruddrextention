import { getApiKey } from './storage.js';

const BASE_URL = 'https://www.ruddr.io/api/workspace';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function ruddrFetch(endpoint, options = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new ApiError('API key not configured', 0);

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body.errors && body.errors.length > 0) {
        message = body.errors.map((e) => e.message || e).join('; ');
      } else if (body.message) {
        message = body.message;
      }
    } catch {}
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function listTimeEntries({ memberId, dateOnOrAfter, dateOnOrBefore }) {
  const params = new URLSearchParams();
  if (memberId) params.set('memberId', memberId);
  if (dateOnOrAfter) params.set('dateOnOrAfter', dateOnOrAfter);
  if (dateOnOrBefore) params.set('dateOnOrBefore', dateOnOrBefore);
  params.set('limit', '100');
  return ruddrFetch(`/time-entries?${params.toString()}`);
}

export async function createTimeEntry(data) {
  return ruddrFetch('/time-entries', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTimeEntry(id, data) {
  return ruddrFetch(`/time-entries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteTimeEntry(id) {
  return ruddrFetch(`/time-entries/${id}`, {
    method: 'DELETE',
  });
}

export async function getTimeEntry(id) {
  return ruddrFetch(`/time-entries/${id}`);
}

export async function listProjects() {
  const results = [];
  let startingAfter = null;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (startingAfter) params.set('startingAfter', startingAfter);
    const response = await ruddrFetch(`/projects?${params.toString()}`);
    const items = response.results || [];
    results.push(...items);
    if (response.hasMore && items.length > 0) {
      startingAfter = items[items.length - 1].id;
    } else {
      startingAfter = null;
    }
  } while (startingAfter);
  return results;
}

export async function listProjectTasks(projectId) {
  return ruddrFetch(`/project-tasks?projectId=${projectId}&limit=100`);
}

export async function listProjectRoles(projectId) {
  return ruddrFetch(`/project-roles?projectId=${projectId}&limit=100`);
}

export async function listProjectMembers() {
  const results = [];
  let startingAfter = null;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (startingAfter) params.set('startingAfter', startingAfter);
    const response = await ruddrFetch(`/project-members?${params.toString()}`);
    const items = response.results || [];
    results.push(...items);
    if (response.hasMore && items.length > 0) {
      startingAfter = items[items.length - 1].id;
    } else {
      startingAfter = null;
    }
  } while (startingAfter);
  return results;
}

export async function listMembers() {
  const results = [];
  let startingAfter = null;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (startingAfter) params.set('startingAfter', startingAfter);
    const response = await ruddrFetch(`/members?${params.toString()}`);
    const items = response.results || [];
    results.push(...items);
    if (response.hasMore && items.length > 0) {
      startingAfter = items[items.length - 1].id;
    } else {
      startingAfter = null;
    }
  } while (startingAfter);
  return results;
}
