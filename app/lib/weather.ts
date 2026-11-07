// Cowes forecast (Open-Meteo) — "<emoji> 15° — Light drizzle".
// Used by /api/dashboard (owner header + morning push) and /api/header (Isola header).
const WEATHER_LAT = -38.4552;
const WEATHER_LNG = 145.2305;

export async function getWeather(): Promise<string> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LNG}&daily=temperature_2m_max,weathercode&timezone=Australia/Melbourne&forecast_days=1`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    const temp = Math.round(data.daily.temperature_2m_max[0]);
    const code = data.daily.weathercode[0];
    const weatherMap: Record<number, [string, string]> = {
      0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'],
      3: ['Overcast', '☁️'], 45: ['Foggy', '🌫️'], 48: ['Icy fog', '🌫️'],
      51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
      61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
      80: ['Light showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '⛈️'],
      95: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️'],
    };
    const [desc, emoji] = weatherMap[code] || ['Unknown', '🌡️'];
    return `${emoji} ${temp}° — ${desc}`;
  } catch {
    return '🌡️ Weather unavailable';
  }
}
