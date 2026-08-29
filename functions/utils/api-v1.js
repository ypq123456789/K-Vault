const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export function apiSuccess(payload = {}, status = 200, headers = {}) {
  return new Response(
    JSON.stringify({
      success: true,
      ...payload,
    }),
    {
      status,
      headers: {
        ...JSON_HEADERS,
        ...headers,
      },
    }
  );
}

export function apiError(code, message, status = 400, extra = {}, headers = {}) {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code,
        message,
        ...extra,
      },
    }),
    {
      status,
      headers: {
        ...JSON_HEADERS,
        ...headers,
      },
    }
  );
}

export function decodePathParam(rawValue = '') {
  try {
    return decodeURIComponent(String(rawValue || ''));
  } catch {
    return String(rawValue || '');
  }
}

export function parsePositiveInt(rawValue, { defaultValue = 0, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

export function parseBoolean(rawValue, fallback = false) {
  if (rawValue == null) return fallback;
  const value = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled', 'enable'].includes(value)) return true;
  if (['0', 'false', 'no', 'off', 'disabled', 'disable'].includes(value)) return false;
  return fallback;
}

export function buildAbsoluteUrl(request, path, preferredBase = '') {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  const base = String(preferredBase || '').trim().replace(/\/+$/, '');
  if (base) return `${base}${normalizedPath}`;
  const origin = new URL(request.url).origin;
  return `${origin}${normalizedPath}`;
}
