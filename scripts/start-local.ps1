param([switch]$SetupOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $runtimeFolder = Join-Path $env:LOCALAPPDATA 'zenaccurate-dev'
  $runtime = Get-ChildItem -LiteralPath $runtimeFolder -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $runtime) { throw 'Install Node.js 22.16+ atau 24 LTS, lalu jalankan kembali script ini.' }
  $env:PATH = $runtime.FullName + ';' + $env:PATH
}
if (-not (Test-Path -LiteralPath 'node_modules')) {
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Instalasi dependency backend gagal.' }
}
if (-not (Test-Path -LiteralPath '.env')) {
  npm.cmd run demo:setup
  if ($LASTEXITCODE -ne 0) { throw 'Setup database demo gagal.' }
}
Write-Host 'Backend: http://localhost:4000. Akun demo tersedia di .env backend.'
if (-not $SetupOnly) {
  $taskDatabaseConfig = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^DATABASE_URL\s*=\s*["'']?pglite:' }
  if ($taskDatabaseConfig) {
    Write-Host 'Demo PGlite: menjalankan satu proses backend tanpa hot reload. Restart setelah mengubah kode backend.'
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build backend gagal.' }
    npm.cmd start
  } else { npm.cmd run dev }
  exit $LASTEXITCODE
}
