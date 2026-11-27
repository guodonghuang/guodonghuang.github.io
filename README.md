# XinXi - Socks & Underwear Showcase

- Frontend: `index.html` (official site) + `admin.html` (admin panel), auto-deployed via GitHub Pages (CNAME: huangmengmeng.abrdns.com)
- Backend: `worker/` - Cloudflare Workers + D1 (login, products CRUD, shop settings, QR upload/download)
- Default products: `assets/products.js` (used as fallback when API unavailable)

## Admin dynamic configuration

In the Contacts tab of `admin.html`:
- 3 QR codes (WeChat group / Douyin / Official Account) and the Douyin ID are all dynamically configurable
- You can paste a direct image URL, or drag an image into the input field to auto-upload (saved to the D1 upload_files table, accessed at /uploads/xxx)
- Save on the official site, and the frontend JS fetches `/api/settings` at startup, overriding the default values with the backend configuration
- Shop info tab: dynamically sets the shop name, address, and About text

## Deploy Steps

1. `npx wrangler d1 create xinxi-db` (write the returned database_id into `worker/wrangler.toml`)
2. `npx wrangler d1 execute xinxi-db --remote --file worker/schema.sql` (create tables)
3. Create an admin (default admin / xinxi123, be sure to change it later):
   `npx wrangler d1 execute xinxi-db --remote --command "INSERT INTO admins(username,salt,password_hash) VALUES('admin','xinxisalt', sha256hex('xinxi123xinxisalt'))"`
4. `npx wrangler deploy` (in the worker/ directory)
5. In the Cloudflare Worker console, set two environment variables: `WORKER_SECRET` (a random long string) and `ALLOW_ORIGIN` (the official site domain, multiple separated by commas)
6. In `index.html` and `admin.html`, set `API_BASE` to your Worker URL (currently the placeholder xinxi-api.example.workers.dev)
7. Commit and push, GitHub Pages auto-deploys; log in at admin.html and configure the QR codes and shop info. Done.
