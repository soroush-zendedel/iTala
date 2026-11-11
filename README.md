# ITALA – Live Gold Price Website

A lightweight, open-source website for buying second-hand gold in Zahedan (Iran).  
The site shows live 18k / melted gold prices powered by the [Nerkh API](https://nerkh.io), with the API token kept secret through a Cloudflare Worker.

**Live site:** [https://itala.top](https://itala.top)

---

## Features

- Live gold price (18-karat & melted) in Toman
- Price comparison calculator
- Historical price chart (daily / weekly / monthly)
- Bilingual (Persian / English)
- Dark / light mode
- Fully static frontend + serverless price backend
- Open source – no secrets in the repository

---

## Architecture

```
Browser (itala.top)
        │
        ▼
Cloudflare Worker (api.itala.top)
        │  (NERKH_IO_TOKEN is stored as a Worker Secret)
        ▼
Nerkh API  →  returns GOLD18K price
        │
        ▼
Cloudflare KV  →  stores current price + history
```

- The frontend never sees the Nerkh token.
- The Worker proxies the request and keeps a short cache + daily history in KV.
- A Cron Trigger updates the price every hour.

---

## Project Structure

```
.
├── index.html              # Main website
├── data/                   # Local fallback price files
├── docs/                   # Nerkh API OpenAPI spec
├── worker/                 # Cloudflare Worker
│   ├── src/index.js
│   ├── wrangler.toml
│   ├── package.json
│   └── README.md           # Detailed Worker setup guide
├── .github/workflows/      # Auto-deploy Worker on push
└── .env.example
```

---

## Quick Start (Frontend only)

The website is static. You can open `index.html` directly or serve it with any static host (GitHub Pages, Cloudflare Pages, Netlify, etc.).

The frontend expects the price API at:

```
https://api.itala.top/api/price
https://api.itala.top/api/history
```

If the API is unavailable it falls back to the local files in `/data`.

---

## Worker Setup

See the detailed guide: **[worker/README.md](worker/README.md)**

### Summary

1. Create a KV namespace and put the IDs in `worker/wrangler.toml`
2. Create a Cloudflare API Token (Edit Workers)
3. Add these GitHub Secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `NERKH_IO_TOKEN`
4. Push to `main` → GitHub Actions deploys the Worker automatically
5. Attach the custom domain `api.itala.top` to the Worker in the Cloudflare dashboard

> **Note:** The `*.workers.dev` subdomain may not work reliably from some networks in Iran. Always use a custom domain.

---

## API Endpoints (Worker)

| Endpoint        | Description                          |
|-----------------|--------------------------------------|
| `GET /`         | Health check + binding status        |
| `GET /api/price`| Current GOLD18K price (Toman)        |
| `GET /api/history` | Price history array               |

Example response from `/api/price`:

```json
{
  "price": 25137250,
  "price18k": 25137250,
  "priceMelted": 25137250,
  "unit": "toman",
  "symbol": "GOLD18K",
  "updated": "...",
  "ch_24h_percent": 0.85,
  "fetchedAt": 1731350000000
}
```

The frontend applies its own margin (`MULTIPLIER = 0.98`) on top of this value.

---

## Environment Variables / Secrets

| Name                   | Where it lives              | Purpose                    |
|------------------------|-----------------------------|----------------------------|
| `NERKH_IO_TOKEN`       | Worker Secret + GitHub Secrets | Nerkh API Bearer token  |
| `CLOUDFLARE_API_TOKEN` | GitHub Secrets              | Deploy with Wrangler       |
| `CLOUDFLARE_ACCOUNT_ID`| GitHub Secrets              | Cloudflare account         |

Never commit real tokens. Use `.env` / `.dev.vars` only locally (both are git-ignored).

---

## Development

```bash
# Frontend – just open index.html or use any static server
npx serve .

# Worker
cd worker
npm install
# create .dev.vars with NERKH_IO_TOKEN=...
npx wrangler dev
```

---

## License

This project is open source.  
Feel free to fork and adapt it for your own gold / currency price website.
```
