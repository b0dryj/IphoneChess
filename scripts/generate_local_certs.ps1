param(
    [string]$LanIp
)

$ErrorActionPreference = "Stop"

function Test-PrivateIPv4 {
    param(
        [string]$IpAddress
    )

    return $IpAddress -like "10.*" -or
        $IpAddress -like "192.168.*" -or
        $IpAddress -match "^172\.(1[6-9]|2[0-9]|3[0-1])\."
}

function Get-LanIp {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            (Test-PrivateIPv4 $_.IPAddress) -and
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.PrefixOrigin -ne "WellKnown" -and
            $_.InterfaceAlias -notmatch "Tailscale|ZeroTier|vEthernet|VirtualBox|VMware|WSL"
        } |
        Sort-Object InterfaceMetric, SkipAsSource

    if ($addresses) {
        return $addresses[0].IPAddress
    }

    throw "Could not detect LAN IP automatically. Pass it manually with -LanIp."
}

if (-not $LanIp) {
    $LanIp = Get-LanIp
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$certsDir = Join-Path $repoRoot "certs"
New-Item -ItemType Directory -Force -Path $certsDir | Out-Null

$rootKey = Join-Path $certsDir "local-root-ca.key"
$rootPem = Join-Path $certsDir "local-root-ca.pem"
$rootCer = Join-Path $certsDir "local-root-ca.cer"
$rootSrl = Join-Path $certsDir "local-root-ca.srl"
$serverKey = Join-Path $certsDir "local-server.key"
$serverPem = Join-Path $certsDir "local-server.pem"
$serverCsr = Join-Path $certsDir "local-server.csr"
$serverExt = Join-Path $certsDir "local-server.ext"
$serverIpFile = Join-Path $certsDir "local-server-ip.txt"

if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    throw "OpenSSL was not found in PATH."
}

if (-not (Test-Path $rootKey) -or -not (Test-Path $rootPem)) {
    & openssl genrsa -out $rootKey 4096
    & openssl req -x509 -new -nodes -key $rootKey -sha256 -days 3650 -out $rootPem -subj "/CN=Local Chess PWA Root CA"
}

Copy-Item $rootPem $rootCer -Force

$currentIp = ""
if (Test-Path $serverIpFile) {
    $currentIp = (Get-Content $serverIpFile -Raw).Trim()
}

$needsServerCert = $true
if ((Test-Path $serverKey) -and (Test-Path $serverPem) -and $currentIp -eq $LanIp) {
    $needsServerCert = $false
}

if ($needsServerCert) {
    @"
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
DNS.1=localhost
DNS.2=$env:COMPUTERNAME
DNS.3=$($env:COMPUTERNAME).local
IP.1=127.0.0.1
IP.2=$LanIp
"@ | Set-Content -Path $serverExt -Encoding ascii

    & openssl genrsa -out $serverKey 2048
    & openssl req -new -key $serverKey -out $serverCsr -subj "/CN=$LanIp"
    & openssl x509 -req -in $serverCsr -CA $rootPem -CAkey $rootKey -CAcreateserial -out $serverPem -days 825 -sha256 -extfile $serverExt
    Set-Content -Path $serverIpFile -Value $LanIp -Encoding ascii
}

if (Test-Path $serverCsr) {
    try {
        Remove-Item -LiteralPath $serverCsr -Force -ErrorAction Stop
    }
    catch {
        Write-Output "Warning: could not remove temporary file $serverCsr. This does not block the app."
    }
}

Write-Output "LAN IP: $LanIp"
Write-Output "Root CA: $rootCer"
Write-Output "Server cert: $serverPem"
Write-Output "Server key: $serverKey"
