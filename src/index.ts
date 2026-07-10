export interface Env {
  API_KEY: string;
}

type ProxyRequestBody = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown> | null;
};

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const BLOCKED_HOST_SUFFIXES = [".local", ".internal"];

const ALLOWED_ORIGINS = ["https://valmsn.com", "https://www.valmsn.com", "http://localhost:3000", "http://127.0.0.1:3000"];

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type,x-api-key,authorization,cookie",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
      "access-control-max-age": "600",
      "vary": "origin",
    };
  }
  return {};
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  if (h.includes(":")) {
    if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
      return true;
    }
  }

  return false;
}

function normalizeBody(
  body: ProxyRequestBody["body"],
  headers: Record<string, string>,
): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;

  const contentType = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  if (contentType.includes("application/json")) {
    return JSON.stringify(body);
  }
  return JSON.stringify(body);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie") {
      out["set-cookie"] = out["set-cookie"] ? out["set-cookie"] + "\n" + value : value;
    } else {
      out[lower] = value;
    }
  });
  return out;
}

function buildUpstreamHeaders(
  target: URL,
  headers: Record<string, string> | undefined,
): Headers {
  const out = new Headers();
  const blocked = new Set(["host", "content-length", "connection", "transfer-encoding"]);

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (blocked.has(key.toLowerCase())) continue;
      out.set(key, value);
    }
  }
  out.set("host", target.host);
  return out;
}

async function handleProxy(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get("x-api-key");
  if (!env.API_KEY || apiKey !== env.API_KEY) {
    return jsonError(401, "Invalid or missing API key");
  }

  let payload: ProxyRequestBody;
  try {
    payload = (await request.json()) as ProxyRequestBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  if (!payload.url || typeof payload.url !== "string") {
    return jsonError(400, "Field url is required");
  }

  let target: URL;
  try {
    target = new URL(payload.url);
  } catch {
    return jsonError(400, "Invalid url");
  }

  if (target.protocol !== "https:") {
    return jsonError(400, "Only https:// targets are allowed");
  }

  if (isBlockedHostname(target.hostname)) {
    return jsonError(403, "Target host is not allowed");
  }

  const method = (payload.method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return jsonError(400, `Unsupported method: ${method}`);
  }

  const headerRecord = payload.headers ?? {};
  const upstreamHeaders = buildUpstreamHeaders(target, headerRecord);
  const body = normalizeBody(payload.body, headerRecord);
  const hasBody = body !== undefined && method !== "GET" && method !== "HEAD";

  const upstreamRequest = new Request(target.toString(), {
    method,
    headers: upstreamHeaders,
    body: hasBody ? body : undefined,
    redirect: "manual",
  });

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamRequest);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream fetch failed";
    return jsonError(502, message);
  }

  const responseBody = await upstreamResponse.text();

  return new Response(
    JSON.stringify({
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: headersToRecord(upstreamResponse.headers),
      body: responseBody,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          service: "cloudflare-proxy",
          endpoint: "POST /proxy",
          auth: "Header x-api-key must match worker env API_KEY",
          body: {
            url: "https://example.com/path (required)",
            method: "GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS (optional, default GET)",
            headers: "Record<string, string> (optional)",
            body: "string | object | null (optional)",
          },
        }),
        { headers: { ...cors, "content-type": "application/json; charset=utf-8" } },
      );
    }

    if (pathname === "/proxy" && request.method === "POST") {
      const response = await handleProxy(request, env);
      for (const [key, value] of Object.entries(cors)) {
        response.headers.set(key, value);
      }
      return response;
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...cors, "content-type": "application/json; charset=utf-8" },
    });
  },
};