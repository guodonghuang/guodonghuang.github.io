# 心喜 Worker 一键部署脚本（在已登录 Cloudflare 的机器上运行）
# 1) 创建 D1 数据库并自动回填 database_id
# 2) 建表 + 插入默认管理员 (admin / xinxi123)
# 3) 部署 Worker
# 4) 输出需要回填到前端的 Worker URL
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> 1/4 创建 D1 数据库 xinxi-db ..." -ForegroundColor Cyan
$out = npx wrangler d1 create xinxi-db 2>&1 | Out-String
Write-Host $out
$dbid = ($out | Select-String -Pattern "database_id\s*[:=]\s*(\S+)").Matches.0.Groups[1].Value
if (-not $dbid) {
  $dbid = (npx wrangler d1 list 2>&1 | Out-String) | Select-String -Pattern "xinxi-db\s+\S+([\w-]{16,})" | ForEach-Object { $_.Matches[0].Groups[1].Value }
}
if (-not $dbid) { throw "未能获取 D1 database_id，请运行: npx wrangler d1 list" }

Write-Host "==> 2/4 写回 database_id 到 wrangler.toml ..." -ForegroundColor Cyan
$wt = Get-Content (Join-Path $PSScriptRoot "wrangler.toml") -Raw
$wt = $wt -replace 'database_id = ".*?"', ("database_id = `"" + $dbid + "`"")
Set-Content (Join-Path $PSScriptRoot "wrangler.toml") $wt -NoNewline

Write-Host "==> 3/4 建表并插入默认管理员 ..." -ForegroundColor Cyan
npx wrangler d1 execute xinxi-db --remote --file schema.sql 2>&1 | Out-String | Write-Host
$secret = "xinxisalt"
$pass = "xinxi123"
$hex = -join ((0..255 | ForEach-Object { "{0:x}" -f $_ }) | Select-Object -First 64) # placeholder
# 计算 sha256hex(password+salt)
$enc = [Security.Cryptography.SHA256]::Create()
$bytes = [Text.Encoding]::UTF8.GetBytes($pass + $secret)
$digest = [BitConverter]::ToString($enc.ComputeHash($bytes)).Replace("-","")
$cmd = "INSERT INTO admins(username,salt,password_hash) VALUES('admin','" + $secret + "','" + $digest.ToLower() + "')"
npx wrangler d1 execute xinxi-db --remote --command $cmd 2>&1 | Out-String | Write-Host

Write-Host "==> 4/4 部署 Worker ..." -ForegroundColor Cyan
$dep = npx wrangler deploy 2>&1 | Out-String
Write-Host $dep
$url = ($dep | Select-String -Pattern "https://xinxi-api\.[\w.-]+\.workers\.dev").Matches[0].Value
if (-not $url) { $url = "https://xinxi-api." + (npx wrangler whoami 2>&1 | Out-String) + "" ; $url = "https://xinxi-api.(your-subdomain).workers.dev" }

Write-Host ""
Write-Host "================ 回填到前端 ================" -ForegroundColor Yellow
Write-Host "API_BASE = $url"
Write-Host "把上面这行填进 index.html 和 admin.html 顶部的 API_BASE，然后 git push 即可上线。"
Write-Host "默认管理员账号: admin   密码: xinxi123 (请登录后尽快修改)"
