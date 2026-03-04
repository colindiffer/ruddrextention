const GA_MEASUREMENT_ID = 'G-CBEGQG65TX';
const GA_API_SECRET = '9J_9TJ6xR1SP_zJa7SiU0g';

let cachedClientId = null;

/**
 * Gets or creates a persistent client ID for GA.
 */
async function getClientId() {
  if (cachedClientId) return cachedClientId;

  return new Promise((resolve) => {
    chrome.storage.local.get(['ga_client_id'], async (result) => {
      if (result.ga_client_id) {
        cachedClientId = result.ga_client_id;
        resolve(cachedClientId);
      } else {
        const newId = self.crypto.randomUUID ? self.crypto.randomUUID() : 
          ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
          );
        chrome.storage.local.set({ ga_client_id: newId }, () => {
          cachedClientId = newId;
          resolve(newId);
        });
      }
    });
  });
}

/**
 * Sends an event to Google Analytics 4 via Measurement Protocol.
 * @param {string} eventName 
 * @param {object} eventParams 
 */
export async function trackEvent(eventName, eventParams = {}) {
  try {
    const clientId = await getClientId();
    const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    const platform = isExtension ? 'Chrome Extension' : 'Windows App';

    const body = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          ...eventParams,
          engagement_time_msec: '100', // Basic requirement for GA4 active users
          platform_type: platform,
          app_version: '1.0.2' // Match manifest/package.json
        }
      }]
    };

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;

    await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    
    // console.log(`[Analytics] Tracked ${eventName}`, eventParams);
  } catch (error) {
    console.error('[Analytics] Error tracking event:', error);
  }
}

/**
 * Specialized event for page/view tracking.
 * @param {string} viewName 
 */
export async function trackView(viewName) {
  return trackEvent('page_view', { page_title: viewName, page_location: viewName });
}
