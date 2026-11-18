param([string]$RuntimeConfig = 'data/mysql-local-runtime.json')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath $RuntimeConfig)) {
  throw 'Konfigurasi MySQL portable tidak ditemukan. Gunakan Docker Compose atau instalasi MySQL tim; lihat docs/mysql-migration.md.'
}
$taskMysql = Get-Content -LiteralPath $RuntimeConfig -Raw | ConvertFrom-Json
$taskBinary = (Resolve-Path -LiteralPath $taskMysql.binary).Path
$taskData = (Resolve-Path -LiteralPath $taskMysql.dataDirectory).Path
$taskBase = Split-Path -Parent (Split-Path -Parent $taskBinary)
$taskPort = [int]$taskMysql.port
if ($taskPort -lt 1 -or $taskPort -gt 65535 -or (Split-Path -Leaf $taskBinary) -ne 'mysqld.exe') {
  throw 'Konfigurasi runtime MySQL tidak valid.'
}
if (-not (Test-Path -LiteralPath (Join-Path $taskData 'mysql'))) {
  throw 'Direktori ini belum berisi MySQL yang diinisialisasi. Script tidak membuat atau mereset database.'
}
if (Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue) {
  Write-Host "Port $taskPort sudah digunakan. Periksa koneksi MySQL; tidak ada proses baru dijalankan."
  exit 0
}
$taskArguments = @('--no-defaults', "--basedir=`"$taskBase`"", "--datadir=`"$taskData`"",
  "--port=$taskPort", '--bind-address=127.0.0.1', '--mysqlx=OFF', '--default-time-zone=+00:00',
  '--character-set-server=utf8mb4', '--collation-server=utf8mb4_0900_bin', '--innodb-buffer-pool-size=128M',
  "--log-error=`"$(Join-Path $taskData 'server.log')`"")
$taskProcess = Start-Process -FilePath $taskBinary -ArgumentList $taskArguments -WindowStyle Hidden -PassThru
Write-Host "MySQL lokal dijalankan di 127.0.0.1:$taskPort (PID $($taskProcess.Id)). Password tetap mengikuti konfigurasi privat yang sudah ada."
