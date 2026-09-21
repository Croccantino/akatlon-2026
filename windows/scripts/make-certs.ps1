# Genera la CA locale + certificato HTTPS per FireTracker su Windows.
# Prerequisiti: PowerShell + openssl.exe (incluso con Git for Windows).
# Uso: apri PowerShell nella cartella del progetto e lancia
#   powershell -ExecutionPolicy Bypass -File scripts\make-certs.ps1
# Rilanciare se cambia l'IP della rete.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force -Path certs | Out-Null
Set-Location certs

# IP IPv4 della rete (esclude loopback e reti virtuali Docker/WSL)
$IPList = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch '^(127\.)' -and $_.IPAddress -notmatch '^(169\.254\.)' -and $_.IPAddress -notmatch '^(172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.IPAddress -notmatch '^(10\.255\.255\.)' } |
    Select-Object -ExpandProperty IPAddress -Unique

if (-not $IPList) {
    Write-Host "Nessun IP di rete trovato. Certificato solo per localhost."
}

# Mantiene anche IP salvati in precedenza
if (Test-Path ips.txt) {
    $IPList = @($IPList) + @(Get-Content ips.txt)
}
$IPList = $IPList | Sort-Object -Unique
$IPList | Set-Content ips.txt

# CA (generata una volta, va installata sui dispositivi per la posizione GPS)
if (-not (Test-Path ca-key.pem) -or -not (Test-Path ca-cert.pem)) {
    & openssl req -x509 -newkey rsa:2048 -days 3650 -nodes `
        -keyout ca-key.pem -out ca-cert.pem -subj "/CN=FireTracker CA" `
        -addext "basicConstraints=critical,CA:TRUE" 2>$null
}

# SAN con tutti gli IP + localhost
$SAN = "DNS:localhost,IP:127.0.0.1"
foreach ($ip in $IPList) {
    $SAN += ",IP:$ip"
}

& openssl req -newkey rsa:2048 -nodes -new `
    -keyout server-key.pem -out server.csr -subj "/CN=FireTracker" 2>$null

Set-Content -Path ext.cnf -Value "basicConstraints=CA:FALSE`nsubjectAltName=$SAN"
& openssl x509 -req -days 825 -in server.csr -CA ca-cert.pem -CAkey ca-key.pem `
    -CAcreateserial -out server-cert.pem -extfile ext.cnf 2>$null
Remove-Item server.csr, ext.cnf -ErrorAction SilentlyContinue

Write-Host "Certificato HTTPS rigenerato per gli IP: $($IPList -join ', ')"
Write-Host "Per la posizione dal telefono: installa certs\ca-cert.pem sul dispositivo come 'Certificato CA'."