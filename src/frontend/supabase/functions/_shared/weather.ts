/**
 * Weather provider adapters for the Connector Hub's `weather_api` type.
 *
 * A weather source is not shaped like a sensor feed: it returns one object of
 * current conditions, not an array of (asset, tag, value) records. These
 * adapters turn that object into the same Point contract sensor-sync's REST
 * path produces, so both write through one code path.
 *
 * Pure logic + fetch, no Deno APIs — the edge function imports this, and it can
 * be exercised directly from Node against the live providers.
 *
 * Keep the support table in step with WEATHER_SUPPORT in
 * src/types/connectors.ts, or the wizard will offer a measurement the worker
 * has to skip.
 */

export interface WeatherConfig {
    provider: 'openmeteo' | 'openweather' | 'weatherapi';
    api_key?: string;
    latitude: number;
    longitude: number;
    units?: 'metric' | 'imperial';
    /** which measurements to pull, e.g. ['temperature','humidity'] */
    data_points?: string[];
    /** asset tag or id these readings attach to */
    asset: string;
}

/** One normalised reading point — the contract sensor-sync writes. */
export interface Point {
    assetToken: string; tag: string; value: number;
    unit: string; ts: string; hi: number | null; lo: number | null;
}

export const getPath = (o: unknown, path?: string): unknown =>
    !path ? o : path.split('.').reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), o);

/** `req` is the variable name to ask for (Open-Meteo); `path` is where the
 *  value comes back; `unit` is what it arrives in per unit system. */
type PointSpec = { req?: string; path: string; unit: { metric: string; imperial: string } };

export const WEATHER_PROVIDERS: Record<string, {
    label: string;
    needsKey: boolean;
    points: Record<string, PointSpec>;
    url: (c: WeatherConfig, reqVars: string[]) => string;
}> = {
    // Free, no API key — the fastest way to prove the pipe end to end.
    openmeteo: {
        label: 'Open-Meteo',
        needsKey: false,
        points: {
            temperature: { req: 'temperature_2m', path: 'current.temperature_2m', unit: { metric: '°C', imperial: '°F' } },
            humidity: { req: 'relative_humidity_2m', path: 'current.relative_humidity_2m', unit: { metric: '%', imperial: '%' } },
            wind_speed: { req: 'wind_speed_10m', path: 'current.wind_speed_10m', unit: { metric: 'km/h', imperial: 'mph' } },
            precipitation: { req: 'precipitation', path: 'current.precipitation', unit: { metric: 'mm', imperial: 'in' } },
            pressure: { req: 'surface_pressure', path: 'current.surface_pressure', unit: { metric: 'hPa', imperial: 'hPa' } },
        },
        url: (c, reqVars) => {
            const p = new URLSearchParams({
                latitude: String(c.latitude), longitude: String(c.longitude),
                current: reqVars.join(','), timezone: 'UTC',
            });
            if (c.units === 'imperial') {
                p.set('temperature_unit', 'fahrenheit');
                p.set('wind_speed_unit', 'mph');
                p.set('precipitation_unit', 'inch');
            }
            return `https://api.open-meteo.com/v1/forecast?${p}`;
        },
    },
    openweather: {
        label: 'OpenWeatherMap',
        needsKey: true,
        points: {
            temperature: { path: 'main.temp', unit: { metric: '°C', imperial: '°F' } },
            humidity: { path: 'main.humidity', unit: { metric: '%', imperial: '%' } },
            wind_speed: { path: 'wind.speed', unit: { metric: 'm/s', imperial: 'mph' } },
            precipitation: { path: 'rain.1h', unit: { metric: 'mm', imperial: 'mm' } },
            pressure: { path: 'main.pressure', unit: { metric: 'hPa', imperial: 'hPa' } },
            visibility: { path: 'visibility', unit: { metric: 'm', imperial: 'm' } },
        },
        url: (c) => `https://api.openweathermap.org/data/2.5/weather?lat=${c.latitude}&lon=${c.longitude}` +
            `&appid=${encodeURIComponent(c.api_key ?? '')}&units=${c.units === 'imperial' ? 'imperial' : 'metric'}`,
    },
    weatherapi: {
        label: 'WeatherAPI.com',
        needsKey: true,
        points: {
            temperature: { path: 'current.temp_c', unit: { metric: '°C', imperial: '°F' } },
            humidity: { path: 'current.humidity', unit: { metric: '%', imperial: '%' } },
            wind_speed: { path: 'current.wind_kph', unit: { metric: 'km/h', imperial: 'mph' } },
            precipitation: { path: 'current.precip_mm', unit: { metric: 'mm', imperial: 'in' } },
            pressure: { path: 'current.pressure_mb', unit: { metric: 'hPa', imperial: 'inHg' } },
            visibility: { path: 'current.vis_km', unit: { metric: 'km', imperial: 'miles' } },
            uv_index: { path: 'current.uv', unit: { metric: 'index', imperial: 'index' } },
            dew_point: { path: 'current.dewpoint_c', unit: { metric: '°C', imperial: '°F' } },
        },
        url: (c) => `https://api.weatherapi.com/v1/current.json?key=${encodeURIComponent(c.api_key ?? '')}` +
            `&q=${c.latitude},${c.longitude}&aqi=no`,
    },
};

/** WeatherAPI serves imperial from different fields on the same response. */
const WEATHERAPI_IMPERIAL: Record<string, string> = {
    temperature: 'current.temp_f', wind_speed: 'current.wind_mph', precipitation: 'current.precip_in',
    pressure: 'current.pressure_in', visibility: 'current.vis_miles', dew_point: 'current.dewpoint_f',
};

export const DEFAULT_POINTS = ['temperature', 'humidity', 'wind_speed', 'precipitation'];

/**
 * Call the provider and turn its response into reading points bound to one
 * asset. Throws with the provider's own message on a bad key, bad coordinates,
 * or an unusable response — the wizard's Test step shows it verbatim.
 */
export async function fetchWeatherPoints(
    cfg: WeatherConfig,
    now: () => string = () => new Date().toISOString(),
): Promise<{ points: Point[]; skipped: string[]; label: string }> {
    const provider = WEATHER_PROVIDERS[cfg?.provider];
    if (!provider) throw new Error(`unknown weather provider "${cfg?.provider}"`);
    if (!cfg.asset?.trim()) throw new Error('weather connector has no target asset — set the asset tag it feeds');

    const lat = Number(cfg.latitude), lon = Number(cfg.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('weather connector needs a numeric latitude and longitude');
    }
    if (provider.needsKey && !cfg.api_key) throw new Error(`${provider.label} requires an API key`);

    const wanted = cfg.data_points?.length ? cfg.data_points : DEFAULT_POINTS;
    const supported = wanted.filter((p) => provider.points[p]);
    const skipped = wanted.filter((p) => !provider.points[p]);
    if (supported.length === 0) {
        throw new Error(`${provider.label} serves none of the selected data points (${wanted.join(', ')})`);
    }

    const reqVars = supported.map((p) => provider.points[p].req).filter(Boolean) as string[];
    const res = await fetch(provider.url({ ...cfg, latitude: lat, longitude: lon }, reqVars));
    if (!res.ok) throw new Error(`${provider.label} responded ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const json = await res.json();

    const imperial = cfg.units === 'imperial';
    const ts = now();
    const points: Point[] = [];
    for (const name of supported) {
        const spec = provider.points[name];
        const path = imperial && cfg.provider === 'weatherapi' && WEATHERAPI_IMPERIAL[name]
            ? WEATHERAPI_IMPERIAL[name]
            : spec.path;
        const raw = getPath(json, path);
        // OpenWeather omits `rain` entirely when it isn't raining — that's a
        // real zero, not a missing reading.
        const value = raw == null && path === 'rain.1h' ? 0 : Number(raw);
        if (!Number.isFinite(value)) continue;
        points.push({
            assetToken: cfg.asset.trim(),
            tag: `weather_${name}`,
            value,
            unit: imperial ? spec.unit.imperial : spec.unit.metric,
            ts, hi: null, lo: null,
        });
    }
    if (points.length === 0) {
        throw new Error(`${provider.label} returned no numeric values for ${supported.join(', ')}`);
    }
    return { points, skipped, label: provider.label };
}
