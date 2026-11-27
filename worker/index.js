// XinXi Shop - Cloudflare Workers + D1 API
// deploy: npx wrangler deploy
// create admin (username admin, password xinxi123), run in D1 console:
//   INSERT INTO admins(username,salt,password_hash) VALUES('admin','xinxisalt', sha256hex('xinxi123xinxisalt'))

function sha256Hex(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
    .then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''));
}

function randomHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    if (p.startsWith('/uploads/')) {
      const row = await env.DB.prepare('SELECT data, content_type FROM upload_files WHERE path = ?')
        .bind(p.slice('/uploads/'.length)).first();
      if (!row) return new Response('Not found', { status: 404 });
      return new Response(row.data, {
        headers: { ...cors(env), 'Content-Type': row.content_type || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    if (p === '/api/health') return json({ ok: true }, 200, env);

    if (p === '/api/login' && req.method === 'POST') {
      const { username, password } = await req.json().catch(() => ({}));
      const admin = await env.DB.prepare('SELECT * FROM admins WHERE username = ?').bind(String(username || '')).first();
      if (!admin || (await sha256Hex(String(password || '') + admin.salt)) !== admin.password_hash) {
        return json({ error: 'wrong account or password' }, 401, env);
      }
      const body = btoa(encodeURIComponent(JSON.stringify({ sub: admin.username, exp: Date.now() + 7 * 864e5 })));
      const sig = await hmac(body, env);
      const token = body + '.' + btoa(String.fromCharCode(...new Uint8Array(sig)));
      return json({ token }, 200, env);
    }

    if (req.method !== 'GET' && !(await verify(req, env))) {
      return json({ error: 'unauthorized' }, 401, env);
    }

    if (p === '/api/products') {
      if (req.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT id, name, category, price, old_price AS oldPrice, tag, description AS desc, image, sort FROM products WHERE visible = 1 ORDER BY sort ASC, id ASC'
        ).all();
        return json(rows.results, 200, env);
      }
      if (req.method === 'POST') {
        const b = await req.json();
        const id = 'p' + Date.now().toString(36) + randomHex(3);
        await env.DB.prepare(
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
        await env.DB.prepare(
          'UPDATE products SET name=?, category=?, price=?, old_price=?, tag=?, description=?, image=? WHERE id=?'
        ).bind(
          b.name, b.category || '', Number(b.price) || 0,
          b.oldPrice ? Number(b.oldPrice) : null, b.tag || '', b.desc || '', b.image || '', mId[1]
        ).run();
        return json({ ok: true }, 200, env);
      }
      if (req.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM products WHERE id=?').bind(mId[1]).run();
        return json({ ok: true }, 200, env);
      }
    }

    if (p === '/api/settings') {
      if (req.method === 'GET') {
        const rows = await env.DB.prepare('SELECT key, value FROM settings').all();
        const out = {};
        rows.results.forEach((r) => { out[r.key] = safeJSON(r.value); });
        return json(out, 200, env);
      }
      if (req.method === 'PUT') {
        const b = await req.json();
        for (const [k, v] of Object.entries(b)) {
          await env.DB.prepare(
            'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind(k, typeof v === 'string' ? v : JSON.stringify(v)).run();
        }
        return json({ ok: true }, 200, env);
      }
    }

    if (p === '/api/upload' && req.method === 'POST') {
      const fd = await req.formData();
      const file = fd.get('file');
      if (!file || !file.type.startsWith('image/')) return json({ error: 'image required' }, 400, env);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: 'image too large (max 5MB)' }, 400, env);
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = 'upload_' + Date.now().toString(36) + '_' + randomHex(4) + '.' + ext;
      await env.DB.prepare('INSERT INTO upload_files(path, content_type, data) VALUES(?,?,?)')
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
