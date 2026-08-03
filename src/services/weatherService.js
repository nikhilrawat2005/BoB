/**
 * weatherService.js
 * Free live weather via Open-Meteo (NO API key required).
 * Uses a built-in table of major Indian cities + geocoding fallback,
 * with a short in-memory cache so we don't hammer the public API.
 */

// ─────────────────────────────────────────────────────────
// Built-in coordinates for common Indian cities (fallback so
// we never depend on a geocoding call for everyday usage).
// ─────────────────────────────────────────────────────────
const CITY_COORDS = {
  'new delhi':       { lat: 28.6139, lon: 77.2090 },
  'delhi':           { lat: 28.6139, lon: 77.2090 },
  'mumbai':          { lat: 19.0760, lon: 72.8777 },
  'bombay':          { lat: 19.0760, lon: 72.8777 },
  'kolkata':         { lat: 22.5726, lon: 88.3639 },
  'calcutta':        { lat: 22.5726, lon: 88.3639 },
  'chennai':         { lat: 13.0827, lon: 80.2707 },
  'madras':          { lat: 13.0827, lon: 80.2707 },
  'bengaluru':       { lat: 12.9716, lon: 77.5946 },
  'bangalore':       { lat: 12.9716, lon: 77.5946 },
  'hyderabad':       { lat: 17.3850, lon: 78.4867 },
  'pune':            { lat: 18.5204, lon: 73.8567 },
  'jaipur':          { lat: 26.9124, lon: 75.7873 },
  'ahmedabad':       { lat: 23.0225, lon: 72.5714 },
  'lucknow':         { lat: 26.8467, lon: 80.9462 },
  'chandigarh':      { lat: 30.7333, lon: 76.7794 },
  'indore':          { lat: 22.7196, lon: 75.8577 },
  'nagpur':          { lat: 21.1458, lon: 79.0882 },
  'bhopal':          { lat: 23.2599, lon: 77.4126 },
  'patna':           { lat: 25.5941, lon: 85.1376 },
  'kanpur':          { lat: 26.4499, lon: 80.3319 },
  'surat':           { lat: 21.1702, lon: 72.8311 },
  'kochi':           { lat: 9.9312, lon: 76.2673 },
  'cochin':          { lat: 9.9312, lon: 76.2673 },
  'thiruvananthapuram': { lat: 8.5241, lon: 76.9366 },
  'guwahati':        { lat: 26.1445, lon: 91.7362 },
  'dehradun':        { lat: 30.3165, lon: 78.0322 },
  'amritsar':        { lat: 31.6340, lon: 74.8723 },
  'vadodara':        { lat: 22.3072, lon: 73.1812 },
  'visakhapatnam':   { lat: 17.6868, lon: 83.2185 },
  'coimbatore':      { lat: 11.0168, lon: 76.9558 },
};

// ─────────────────────────────────────────────────────────
// WMO weather code → friendly label + emoji
// ─────────────────────────────────────────────────────────
const WMO = {
  0:  '☀️ Clear sky',
  1:  '🌤️ Mainly clear',
  2:  '⛅ Partly cloudy',
  3:  '☁️ Overcast',
  45: '🌫️ Foggy',
  48: '🌫️ Foggy (rime)',
  51: '🌦️ Light drizzle',
  53: '🌦️ Drizzle',
  55: '🌧️ Heavy drizzle',
  56: '🌧️ Freezing drizzle',
  57: '🌧️ Freezing drizzle',
  61: '🌦️ Light rain',
  63: '🌧️ Rain',
  65: '🌧️ Heavy rain',
  66: '🌧️ Freezing rain',
  67: '🌧️ Freezing rain',
  71: '🌨️ Light snow',
  73: '❄️ Snow',
  75: '❄️ Heavy snow',
  77: '🌨️ Snow grains',
  80: '🌦️ Light showers',
  81: '🌧️ Showers',
  82: '🌧️ Heavy showers',
  85: '🌨️ Snow showers',
  86: '❄️ Heavy snow showers',
  95: '⛈️ Thunderstorm',
  96: '⛈️ Thunderstorm + hail',
  99: '⛈️ Severe thunderstorm + hail',
};

const CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

async function cached(key, fn) {
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  CACHE.set(key, { value, expires: Date.now() + CACHE_TTL });
  return value;
}

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BobBackend/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a city name to { lat, lon, name }.
 * Built-in table first, Open-Meteo geocoding as fallback.
 */
async function resolveCity(cityName) {
  const normalized = String(cityName || '').trim().toLowerCase();
  const builtin = CITY_COORDS[normalized];
  if (builtin) {
    const pretty = normalized.replace(/\b\w/g, c => c.toUpperCase());
    return { lat: builtin.lat, lon: builtin.lon, name: pretty };
  }

  if (!normalized) {
    const def = CITY_COORDS['new delhi'];
    return { lat: def.lat, lon: def.lon, name: 'New Delhi' };
  }

  try {
    const data = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`
    );
    if (data && data.results && data.results.length) {
      const r = data.results[0];
      return { lat: r.latitude, lon: r.longitude, name: r.name };
    }
  } catch (err) {
    console.warn('[Weather] Geocoding fallback failed:', err.message);
  }

  const def = CITY_COORDS['new delhi'];
  return { lat: def.lat, lon: def.lon, name: cityName };
}

/**
 * Detect which city Master Nikhil is asking about from a message.
 * Returns a city name string or null.
 */
function extractCity(message) {
  const msg = ' ' + String(message || '').toLowerCase().replace(/[.,!?]/g, ' ') + ' ';
  const keys = Object.keys(CITY_COORDS);
  // Sort longest names first so "thiruvananthapuram" wins over nothing weird
  const sorted = keys.slice().sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (msg.includes(key)) {
      return key.replace(/\b\w/g, c => c.toUpperCase());
    }
  }
  return null;
}

/** Fetch current weather + today's min/max for a city. */
async function getWeatherForCity(cityName, lat, lon) {
  const resolved = await resolveCity(cityName);
  const finalLat = lat !== undefined ? lat : resolved.lat;
  const finalLon = lon !== undefined ? lon : resolved.lon;
  const name = resolved.name;

  const data = await cached(`weather:${finalLat},${finalLon}`, async () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${finalLat}&longitude=${finalLon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&timezone=auto&forecast_days=1`;
    const j = await fetchJson(url);
    return {
      current:   j.current,
      daily:     j.daily,
      timezone:  j.timezone,
      updatedAt: j.current ? new Date(j.current.time).toISOString() : null,
    };
  });

  return { city: name, lat: finalLat, lon: finalLon, ...data };
}

/** Compact one-line-ish summary ready for the LLM context. */
function formatWeather(w) {
  if (!w || !w.current) return null;
  const c = w.current;
  const label = WMO[c.weather_code] || '🌡️ Unknown condition';
  const parts = [
    `${w.city}: ${c.temperature_2m}°C (feels ${c.apparent_temperature}°C)`,
    label,
    `humidity ${c.relative_humidity_2m}%`,
    `wind ${c.wind_speed_10m} km/h`,
  ];
  if (w.daily && w.daily.temperature_2m_max && w.daily.temperature_2m_min) {
    parts.push(`today max ${w.daily.temperature_2m_max[0]}°C / min ${w.daily.temperature_2m_min[0]}°C`);
  }
  return parts.join(', ');
}

module.exports = {
  getWeatherForCity,
  extractCity,
  formatWeather,
  resolveCity,
  CITY_COORDS,
};
