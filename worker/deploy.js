// 心喜 Worker 一键部署（Node）
// 用法: node deploy.js   （在已 wrangler login 的机器上）
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const run = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

// 1) 创建 D1（已存在则取 database_id）
let dbid;
try {
  const out = run("npx wrangler d1 create xinxi-db");
  dbid = (out.match(/database_id\s*[=:]?\s*([\w-]+)/) || [])[1];
} catch (e) {
  const list = run("npx wrangler d1 list");
  const line = list.split("\n").find((l) => l.includes("xinxi-db")) || "";
  dbid = (line.match(/[\w-]{16,}/) || [])[0];
}
if (!dbid) throw new Error("拿不到 D1 database_id，请先 npx wrangler login 并确认账号");

// 2) 回填 wrangler.toml
const wt = path.join(__dirname, "wrangler.toml");
let toml = fs.readFileSync(wt, "utf8");
toml = toml.replace(/database_id = .*?"/, `database_id = "${dbid}"`);
fs.writeFileSync(wt, toml, "utf8");
console.log("[1] database_id =", dbid);

// 3) 建表 + 默认管理员 (admin / xinxi123, salt=xinxisalt)
run(`npx wrangler d1 execute xinxi-db --remote --file ${path.join(__dirname, "schema.sql")}`);
const crypto = require("crypto");
const hash = crypto.createHash("sha256").update("xinxi123" + "xinxisalt").digest("hex");
run(`npx wrangler d1 execute xinxi-db --remote --command "INSERT OR IGNORE INTO admins(username,salt,password_hash) VALUES('admin','xinxisalt','${hash}')"`);
console.log("[2] schema + admin(admin/xinxi123) ready, sha256=", hash.slice(0, 12) + "...");

// 4) 部署 Worker
const dep = run("npx wrangler deploy");
const url = (dep.match(/https:\/\/xinxi-api\.[\w.-]+\.workers\.dev/) || [])[0];
console.log("\n===== 回填到前端 =====");
console.log("API_BASE =", url || "(没匹配到 URL，请从上面 wrangler 输出里找 https://xinxi-api.*.workers.dev)");
console.log("账号 admin / 密码 xinxi123，上线后请尽快改密码。");
