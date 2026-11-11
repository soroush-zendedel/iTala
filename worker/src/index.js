/**
 * ITALA Price API – Cloudflare Worker
 * Proxies Nerkh API (token stays secret) and keeps live price history in KV.
 */

const NERKH_BASE = "https://api.nerkh.io";
const GOLD_SYMBOL = "GOLD18K";
const HISTORY_KEY = "price_history";
const CURRENT_KEY = "current_price";
const MAX_HISTORY_DAYS = 365;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return cors(null, 204);
    }

    try {
      if (path === "/" || path === "/health") {
        return cors({
          service: "itala-price-api",
          status: "ok",
          hasKV: !!env.PRICES_KV,
          hasToken: !!env.NERKH_IO_TOKEN,
          endpoints: ["/api/price", "/api/history"],
        });
      }

      if (path === "/api/price" || path === "/price") {
        return cors(await handlePrice(env, ctx));
      }

      if (path === "/api/history" || path === "/history") {
        return cors(await handleHistory(env));
      }

      return cors({ error: "Not found", path }, 404);
    } catch (err) {
      console.error("Worker error:", err);
      return cors(
        {
          error: "Internal error",
          message: String(err?.message || err),
          stack: err?.stack ? String(err.stack).slice(0, 500) : null,
        },
        500
      );
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      updatePriceAndHistory(env).catch((e) =>
        console.error("Cron error:", e)
      )
    );
  },
};

async function handlePrice(env, ctx) {
  // 1. Try cache first
  if (env.PRICES_KV) {
    try {
      const cached = await env.PRICES_KV.get(CURRENT_KEY, { type: "json" });
      if (
        cached &&
        cached.price &&
        Date.now() - (cached.fetchedAt || 0) < 10 * 60 * 1000
      ) {
        return formatPrice(cached);
      }
    } catch (e) {
      console.warn("KV read failed:", e);
    }
  }

  // 2. Live fetch from Nerkh
  const live = await fetchFromNerkh(env);

  // 3. Update cache + history in background
  if (env.PRICES_KV) {
    ctx.waitUntil(
      updatePriceAndHistory(env, live).catch((e) =>
        console.error("Background update failed:", e)
      )
    );
  }

  return formatPrice(live);
}

function formatPrice(data) {
  return {
    price: data.price,
    price18k: data.price,
    priceMelted: data.price,
    unit: "toman",
    symbol: GOLD_SYMBOL,
    updated: data.updated || null,
    ch_24h_percent: data.ch_24h_percent ?? null,
    fetchedAt: data.fetchedAt || Date.now(),
  };
}

async function handleHistory(env) {
  if (!env.PRICES_KV) {
    return { history: [], count: 0, unit: "toman", warning: "KV not bound" };
  }
  try {
    const history =
      (await env.PRICES_KV.get(HISTORY_KEY, { type: "json" })) || [];
    return { history, count: history.length, unit: "toman" };
  } catch (e) {
    return {
      history: [],
      count: 0,
      unit: "toman",
      error: String(e.message || e),
    };
  }
}

async function fetchFromNerkh(env) {
  const token = env.NERKH_IO_TOKEN;
  if (!token) {
    throw new Error(
      "NERKH_IO_TOKEN secret is missing. Run: npx wrangler secret put NERKH_IO_TOKEN"
    );
  }

  const res = await fetch(
    `${NERKH_BASE}/v2/prices/json/gold/${GOLD_SYMBOL}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Nerkh API returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  const prices = body?.data?.prices;

  if (!prices) {
    throw new Error(
      "Unexpected Nerkh response. Full body: " +
        JSON.stringify(body).slice(0, 400)
    );
  }

  // Handle both response shapes
  const currentStr =
    prices.current ??
    prices[GOLD_SYMBOL]?.current ??
    prices.GOLD18K?.current;

  const price = parseInt(String(currentStr || "").replace(/[^\d]/g, ""), 10);

  if (!price || isNaN(price)) {
    throw new Error(
      "Could not parse GOLD18K price. prices object: " +
        JSON.stringify(prices).slice(0, 300)
    );
  }

  return {
    price,
    updated:
      prices.update ||
      prices[GOLD_SYMBOL]?.update ||
      prices.GOLD18K?.update ||
      null,
    ch_24h_percent:
      prices.ch_24h_percent ??
      prices[GOLD_SYMBOL]?.ch_24h_percent ??
      null,
    fetchedAt: Date.now(),
  };
}

async function updatePriceAndHistory(env, alreadyFetched = null) {
  if (!env.PRICES_KV) return null;

  const data = alreadyFetched || (await fetchFromNerkh(env));

  await env.PRICES_KV.put(CURRENT_KEY, JSON.stringify(data));

  let history =
    (await env.PRICES_KV.get(HISTORY_KEY, { type: "json" })) || [];

  const today = new Date().toISOString().slice(0, 10);
  const last = history[history.length - 1];

  if (!last || last.date !== today) {
    history.push({
      date: today,
      timestamp: Date.now(),
      price: data.price,
    });
  } else {
    last.price = data.price;
    last.timestamp = Date.now();
  }

  if (history.length > MAX_HISTORY_DAYS) {
    history = history.slice(history.length - MAX_HISTORY_DAYS);
  }

  await env.PRICES_KV.put(HISTORY_KEY, JSON.stringify(history));
  return data;
}

function cors(body, status = 200) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=30",
  };

  if (body === null) {
    return new Response(null, { status, headers });
  }

  return new Response(JSON.stringify(body, null, 2), { status, headers });
}