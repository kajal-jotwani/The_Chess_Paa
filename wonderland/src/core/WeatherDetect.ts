export type ThemeId = "dawn" | "day" | "dusk" | "night" | "cloudy" | "rain" | "rain_night";

export const THEME_META: Record<ThemeId, { name: string; emoji: string }> = {
  dawn: { name: "Sunrise", emoji: "🌅" }, day: { name: "Sunny day", emoji: "☀️" }, dusk: { name: "Golden evening", emoji: "🌇" },
  night: { name: "Starry night", emoji: "🌙" }, cloudy: { name: "Cloudy", emoji: "⛅" }, rain: { name: "Rainy day", emoji: "🌧️" }, rain_night: { name: "Rainy night", emoji: "🌧️🌙" },
};

/** Theme from the local clock alone. */
export function themeFromClock(d = new Date()): ThemeId {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 5.5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 19.5) return "dusk";
  return "night";
}

/** WMO weather code → is it wet / overcast? */
function classify(code: number): "clear" | "cloudy" | "rain" {
  if ([2, 3, 45, 48].includes(code)) return "cloudy";
  if (code >= 51) return "rain";
  return "clear";
}

/**
 * Best-effort real weather: browser geolocation (if the user allows it) →
 * Open-Meteo current conditions (free, no key).  Falls back to the clock.
 */
export async function detectTheme(): Promise<{ theme: ThemeId; source: string }> {
  const base = themeFromClock();
  if (!("geolocation" in navigator)) return { theme: base, source: "clock" };
  try {
    const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 600000 }));
    const { latitude, longitude } = pos.coords;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}&current=weather_code,is_day&timezone=auto`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error("weather http " + r.status);
    const j = await r.json();
    const code = Number(j?.current?.weather_code ?? 0);
    const isDay = Number(j?.current?.is_day ?? 1) === 1;
    const kind = classify(code);
    let theme: ThemeId = base;
    if (!isDay && (base === "day" || base === "dawn" || base === "dusk")) theme = "night";
    if (kind === "rain") theme = theme === "night" ? "rain_night" : "rain";
    else if (kind === "cloudy" && (theme === "day" || theme === "dawn" || theme === "dusk")) theme = "cloudy";
    return { theme, source: `weather (${code})` };
  } catch {
    return { theme: base, source: "clock" };
  }
}
