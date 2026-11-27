// 心喜 · Cloudflare Workers + D1 API
// 部署：npx wrangler deploy（在本目录）
// 首次请求 /api/bootstrap 会自动建表 + 写入默认管理员 admin/xinxi123
// 前端 index.html / admin.html 里把 API_BASE 替换成本 Worker 的 URL

function sha256Hex(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
    .then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''));
}
function randomHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT '', price REAL NOT NULL DEFAULT 0, old_price REAL, tag TEXT DEFAULT '', description TEXT DEFAULT '', image TEXT DEFAULT '', sort INTEGER DEFAULT 0, visible INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
  "CREATE TABLE IF NOT EXISTS admins (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS upload_files (path TEXT PRIMARY KEY, content_type TEXT, data BLOB NOT NULL, created_at TEXT DEFAULT (datetime('now')))"
];
const DEFAULT_ADMIN = { username: 'admin', salt: 'xinxisalt', password: 'xinxi123' };

async function bootstrapDB(env) {
  for (const sql of SCHEMA) await env['xinxi-api'].prepare(sql).run();
  const exists = await env['xinxi-api'].prepare('SELECT 1 FROM admins WHERE username = ?').bind(DEFAULT_ADMIN.username).first();
  if (!exists) {
    const hash = await sha256Hex(DEFAULT_ADMIN.password + DEFAULT_ADMIN.salt);
    await env['xinxi-api'].prepare('INSERT INTO admins(username,salt,password_hash) VALUES(?,?,?)')
      .bind(DEFAULT_ADMIN.username, DEFAULT_ADMIN.salt, hash).run();
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

    // 自举：建表 + 默认管理员
    if (p === '/api/bootstrap') {
      await bootstrapDB(env);
      return json({ ok: true, admin: 'admin/xinxi123' }, 200, env);
    }

    // 上传文件（存 D1）
    if (p.startsWith('/uploads/')) {
      const row = await env['xinxi-api'].prepare('SELECT data, content_type FROM upload_files WHERE path = ?')
        .bind(p.slice('/uploads/'.length)).first();
      if (!row) return new Response('Not found', { status: 404, headers: cors(env) });
      return new Response(row.data, {
        headers: { ...cors(env), 'Content-Type': row.content_type || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    if (p === '/api/health') return json({ ok: true }, 200, env);

    if (p === '/api/login' && req.method === 'POST') {
      await bootstrapDB(env);
      const { username, password } = await req.json().catch(() => ({}));
      const admin = await env['xinxi-api'].prepare('SELECT * FROM admins WHERE username = ?').bind(String(username || '')).first();
      if (!admin || (await sha256Hex(String(password || '') + admin.salt)) !== admin.password_hash) {
        return json({ error: '账号或密码错误' }, 401, env);
      }
      const body = btoa(encodeURIComponent(JSON.stringify({ sub: admin.username, exp: Date.now() + 7 * 864e5 })));
      const sig = await hmac(body, env);
      const token = body + '.' + btoa(String.fromCharCode(...new Uint8Array(sig)));
      return json({ token }, 200, env);
    }

    if (req.method !== 'GET' && !(await verify(req, env))) {
      return json({ error: '未登录' }, 401, env);
    }


    // 修改密码（需登录 + 旧密码校验）
    if (p === '/api/change-password' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const oldPw = String(b.oldPassword || '');
      const newPw = String(b.newPassword || '');
      if (newPw.length < 6) return json({ error: '新密码至少 6 位' }, 400, env);
      const auth = req.headers.get('Authorization') || '';
      const t = auth.replace('Bearer ', '');
      const bi = t.lastIndexOf('.');
      let username = 'admin';
      if (bi > 0) {
        try {
          const payload = JSON.parse(decodeURIComponent(atob(t.slice(0, bi))));
          if (payload.sub) username = payload.sub;
        } catch (e) {}
      }
      const admin = await env['xinxi-api'].prepare('SELECT * FROM admins WHERE username = ?').bind(username).first();
      if (!admin || (await sha256Hex(oldPw + admin.salt)) !== admin.password_hash) {
        return json({ error: '旧密码不正确' }, 400, env);
      }
      const newSalt = randomHex(12);
      const newHash = await sha256Hex(newPw + newSalt);
      await env['xinxi-api'].prepare('UPDATE admins SET password_hash=?, salt=? WHERE username=?')
        .bind(newHash, newSalt, username).run();
      return json({ ok: true }, 200, env);
    }

    if (p === '/api/products') {
      if (req.method === 'GET') {
        const rows = await env['xinxi-api'].prepare(
          'SELECT id, name, category, price, old_price AS oldPrice, tag, description AS desc, image, sort FROM products WHERE visible = 1 ORDER BY sort ASC, id ASC'
        ).all();
        return json(rows.results, 200, env);
      }
      if (req.method === 'POST') {
        const b = await req.json();
        const id = 'p' + Date.now().toString(36) + randomHex(3);
        await env['xinxi-api'].prepare(
          'INSERT INTO products(id,name,category,price,old_price,tag,description,image,sort) VALUES(?,?,?,?,?,?,?,?,?)'
        ).bind(
          id, b.name || '', b.category || '', Number(b.price) || 0,
          b.oldPrice ? Number(b.oldPrice) : null, b.tag || '', b.desc || '', b.image || '',
          b.sort ? Number(b.sort) : 0
        ).run();
        return json({ id }, 201, env);
      }
    }
    const mId = p.match(/^\/api\/products\/([\w-]+)$/);
    if (mId) {
      if (req.method === 'PUT') {
        const b = await req.json();
        await env['xinxi-api'].prepare(
          'UPDATE products SET name=?, category=?, price=?, old_price=?, tag=?, description=?, image=? WHERE id=?'
        ).bind(
          b.name, b.category || '', Number(b.price) || 0,
          b.oldPrice ? Number(b.oldPrice) : null, b.tag || '', b.desc || '', b.image || '', mId[1]
        ).run();
        return json({ ok: true }, 200, env);
      }
      if (req.method === 'DELETE') {
        await env['xinxi-api'].prepare('DELETE FROM products WHERE id=?').bind(mId[1]).run();
        return json({ ok: true }, 200, env);
      }
    }

    if (p === '/api/settings') {
      if (req.method === 'GET') {
        const rows = await env['xinxi-api'].prepare('SELECT key, value FROM settings').all();
        const out = {};
        rows.results.forEach((r) => { out[r.key] = safeJSON(r.value); });
        return json(out, 200, env);
      }
      if (req.method === 'PUT') {
        const b = await req.json();
        for (const [k, v] of Object.entries(b)) {
          await env['xinxi-api'].prepare(
            'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind(k, typeof v === 'string' ? v : JSON.stringify(v)).run();
        }
        return json({ ok: true }, 200, env);
      }
    }

    if (p === '/api/upload' && req.method === 'POST') {
      const fd = await req.formData();
      const file = fd.get('file');
      if (!file || !file.type.startsWith('image/')) return json({ error: '请上传图片' }, 400, env);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: '图片不能超过 5MB' }, 400, env);
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = 'upload_' + Date.now().toString(36) + '_' + randomHex(4) + '.' + ext;
      await env['xinxi-api'].prepare('INSERT INTO upload_files(path, content_type, data) VALUES(?,?,?)')
        .bind(path, file.type, bytes).run();
      return json({ url: url.origin + '/uploads/' + path }, 201, env);
    }

    return json({ error: 'Not found' }, 404, env);
  },
};

function cors(env) {
  const allow = env ? (env.ALLOW_ORIGIN || '*') : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
function json(obj, status, env) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors(env), 'Content-Type': 'application/json' } });
}
function safeJSON(s) { try { return JSON.parse(s); } catch (e) { return s; } }

async function hmac(data, env) {
  const secret = env.WORKER_SECRET || 'xinxi-secret-change-me';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
}
function verify(req, env) {
  const h = req.headers.get('Authorization') || '';
  const t = h.replace('Bearer ', '');
  const i = t.lastIndexOf('.');
  if (i < 0) return false;
  const body = t.slice(0, i);
  const sig = t.slice(i + 1);
  return hmac(body, env).then((s) => {
    const expect = btoa(String.fromCharCode(...new Uint8Array(s)));
    if (expect !== sig) return false;
    let payload = {};
    try { payload = JSON.parse(decodeURIComponent(atob(body))); } catch (e) { return false; }
    if (payload.exp && payload.exp < Date.now()) return false;
    return true;
  });
}
