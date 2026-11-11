/**
 * ITALA Price API – Cloudflare Worker
 * Proxies Nerkh API (token stays secret) and keeps live price history in KV.
 *
 * - GOLD18K  → price per gram of 18-karat gold (Toman)
 * - MAZANEH  → traditional melted-gold quote (مظنه, per mesghal of 705)
 *              Converted to approx. per-gram 18k-equivalent: mazaneh / 4.3318
 */

const NERKH_BASE = "https://api.nerkh.io";
const SYMBOL_18K = "GOLD18K";
const SYMBOL_MELTED = "MAZANEH"; // مظنه = reference for طلای آب‌شده
const MAZANEH_TO_GRAM_18K = 4.3318; // standard conversion to per-gram 18k
const HISTORY_KEY = "price_history";
const CURRENT_KEY = "current_price";
const MAX_HISTORY_DAYS = 365;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

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
  if (env.PRICES_KV) {
    try {
      const cached = await env.PRICES_KV.get(CURRENT_KEY, { type: "json" });
      if (
        cached &&
        cached.price18k &&
        Date.now() - (cached.fetchedAt || 0) < 10 * 60 * 1000
      ) {
        return formatPrice(cached);
      }
    } catch (e) {
      console.warn("KV read failed:", e);
    }
  }

  const live = await fetchFromNerkh(env);

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
    price: data.price18k, // backward compatible
    price18k: data.price18k,
    priceMelted: data.priceMelted,
    mazaneh: data.mazaneh ?? null,
    unit: "toman",
    symbols: { "18k": SYMBOL_18K, melted: SYMBOL_MELTED },
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

async function fetchOne(env, symbol) {
  const token = env.NERKH_IO_TOKEN;
  if (!token) {
    throw new Error(
      "NERKH_IO_TOKEN secret is missing. Run: npx wrangler secret put NERKH_IO_TOKEN"
    );
  }

  const res = await fetch(
    `${NERKH_BASE}/v2/prices/json/gold/${symbol}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Nerkh ${symbol} → ${res.status}: ${text.slice(0, 250)}`);
  }

  const body = await res.json();
  const prices = body?.data?.prices;
  if (!prices) {
    throw new Error(
      `Unexpected Nerkh response for ${symbol}: ` +
        JSON.stringify(body).slice(0, 300)
    );
  }

  const currentStr =
    prices.current ??
    prices[symbol]?.current ??
    null;

  const value = parseInt(String(currentStr || "").replace(/[^\d]/g, ""), 10);
  if (!value || isNaN(value)) {
    throw new Error(
      `Could not parse ${symbol}. prices: ` +
        JSON.stringify(prices).slice(0, 250)
    );
  }

  return {
    value,
    updated: prices.update || prices[symbol]?.update || null,
    ch_24h_percent:
      prices.ch_24h_percent ?? prices[symbol]?.ch_24h_percent ?? null,
  };
}

async function fetchFromNerkh(env) {
  const [g18, maz] = await Promise.all([
    fetchOne(env, SYMBOL_18K),
    fetchOne(env, SYMBOL_MELTED),
  ]);

  // Convert مظنه (per mesghal 705) → approx. per-gram 18k equivalent
  const priceMeltedPerGram = Math.round(maz.value / MAZANEH_TO_GRAM_18K);

  return {
    price18k: g18.value,
    priceMelted: priceMeltedPerGram,
    mazaneh: maz.value,
    updated: g18.updated || maz.updated,
    ch_24h_percent: g18.ch_24h_percent,
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

  // Store 18k price in history (main series for the chart)
  if (!last || last.date !== today) {
    history.push({
      date: today,
      timestamp: Date.now(),
      price: data.price18k,
      priceMelted: data.priceMelted,
    });
  } else {
    last.price = data.price18k;
    last.priceMelted = data.priceMelted;
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
