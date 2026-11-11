# ITALA Price API (Cloudflare Worker)

این ورکر توکن Nerkh را مخفی نگه می‌دارد و قیمت طلای ۱۸ عیار + تاریخچه زنده را در اختیار سایت قرار می‌دهد.

## Endpoints

| Path | توضیح |
|------|--------|
| `GET /api/price` | قیمت فعلی GOLD18K (تومان) |
| `GET /api/history` | آرایه تاریخچه قیمت |
| `GET /` | وضعیت سرویس |

---

## راه‌اندازی اولیه (فقط یک‌بار)

### ۱. ساخت KV Namespace

در ترمینال:

```bash
cd worker
npm install
npx wrangler login          # اگر قبلاً لاگین نکرده‌اید
```

سپس:

```bash
npx wrangler kv:namespace create PRICES_KV
npx wrangler kv:namespace create PRICES_KV --preview
```

خروجی چیزی شبیه این است:

```
🌀  Creating namespace with title "itala-price-api-PRICES_KV"
✨  Success!
Add the following to your configuration file:
[[kv_namespaces]]
binding = "PRICES_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

آیدی‌های `id` و `preview_id` را کپی کنید و داخل فایل `wrangler.toml` جای این دو خط بگذارید:

```toml
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_PREVIEW_KV_NAMESPACE_ID"
```

### ۲. ساخت Cloudflare API Token

1. برو به: [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. **Create Token** → از قالب **Edit Cloudflare Workers** استفاده کن (یا سفارشی بساز).
3. دسترسی‌های لازم:
   - Account → Cloudflare Workers → Edit
   - Account → Account Settings → Read (اختیاری ولی مفید)
4. توکن را کپی کن (دیگر نمایش داده نمی‌شود).

Account ID را هم از داشبورد Cloudflare (سمت راست صفحه اصلی حساب) بردار.

### ۳. اضافه کردن Secrets در GitHub

در ریپازیتوری GitHub:

**Settings → Secrets and variables → Actions → New repository secret**

این سه مورد را اضافه کن:

| نام Secret              | مقدار                                      |
|-------------------------|--------------------------------------------|
| `CLOUDFLARE_API_TOKEN`  | توکنی که در مرحله ۲ ساختی                  |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID حساب Cloudflare                 |
| `NERKH_IO_TOKEN`        | توکن Bearer که از پنل nerkh.io گرفته‌ای   |

> با وجود `NERKH_IO_TOKEN` در GitHub Secrets، workflow خودش آن را روی Worker ست می‌کند. دیگر نیازی به `wrangler secret put` دستی نیست.

### ۴. اولین دیپلوی

بعد از اینکه:
- آیدی‌های KV را در `wrangler.toml` گذاشتی
- سه Secret بالا را در GitHub اضافه کردی

کافی است کد را به `main` پوش کنی (یا از تب Actions دکمه **Run workflow** را بزنی).

Worker دیپلوی می‌شود و Secret هم ست می‌گردد.

### ۵. اتصال دامنه `api.itala.top`

1. به داشبورد Cloudflare برو → **Workers & Pages** → ورکر `itala-price-api`
2. تب **Triggers** یا **Settings → Domains & Routes**
3. **Add Custom Domain** → `api.itala.top` را وارد کن
4. مطمئن شو رکورد DNS مربوط به `api` در zone `itala.top` روی Cloudflare پروکسی شده باشد (ابرک نارنجی)

بعد از چند دقیقه `https://api.itala.top/api/price` باید جواب بدهد.

---

## دیپلوی‌های بعدی

از این به بعد با هر push به `main`/`master` که فایل‌های داخل پوشه `worker/` تغییر کند، دیپلوی به‌صورت خودکار انجام می‌شود.

می‌توانی از تب **Actions** در GitHub هم دستی workflow را اجرا کنی.

---

## متغیرها و Secrets خلاصه

| نام                    | محل                              | توضیح |
|------------------------|----------------------------------|--------|
| `NERKH_IO_TOKEN`       | GitHub Secrets + Worker Secret   | توکن Nerkh |
| `CLOUDFLARE_API_TOKEN` | GitHub Secrets                   | برای دیپلوی |
| `CLOUDFLARE_ACCOUNT_ID`| GitHub Secrets                   | شناسه حساب |
| `PRICES_KV`            | wrangler.toml (KV binding)       | تاریخچه قیمت |

---

## توسعه محلی

```bash
cd worker
npm install
```

فایل `.dev.vars` بساز (این فایل gitignore شده):

```
NERKH_IO_TOKEN=توکن_نرخ_اینجا
```

سپس:

```bash
npx wrangler dev
```

---

## Cron

هر ساعت یک‌بار (`0 * * * *`) قیمت را از Nerkh می‌گیرد و در صورت نیاز تاریخچه را در KV آپدیت می‌کند.
