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
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
  throw 'Lengkapi .env dengan koneksi MySQL, secret autentikasi, dan ENCRYPTION_KEY. Jalankan db:migrate serta import akun atau seed admin sebelum memulai backend.'
}
Write-Host 'Backend MySQL: pastikan database aktif dan migration sudah dijalankan.'
if (-not $SetupOnly) {
  npm.cmd run dev
  exit $LASTEXITCODE
}
