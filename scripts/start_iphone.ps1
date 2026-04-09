param(
    [string]$LanIp,
    [switch]$RegenerateCert
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$certsDir = Join-Path $repoRoot "certs"
$ipFile = Join-Path $certsDir "local-server-ip.txt"
$generateScript = Join-Path $PSScriptRoot "generate_local_certs.ps1"

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

$savedIp = ""
if (Test-Path $ipFile) {
    $savedIp = (Get-Content $ipFile -Raw).Trim()
}

if ($RegenerateCert -or -not (Test-Path $ipFile) -or $savedIp -ne $LanIp) {
    & powershell -ExecutionPolicy Bypass -File $generateScript -LanIp $LanIp
}

$env:HOST = "0.0.0.0"
$env:PORT = "8000"
$env:HTTPS_PORT = "8443"
$env:LAN_IP = $LanIp
$env:SSL_CERT_FILE = Join-Path $certsDir "local-server.pem"
$env:SSL_KEY_FILE = Join-Path $certsDir "local-server.key"

Write-Output "Starting iPhone-ready app..."
Write-Output "HTTP:  http://$LanIp:8000"
Write-Output "HTTPS: https://$LanIp:8443"
Write-Output "Root certificate download: http://$LanIp:8000/local-root-ca.cer"

Set-Location $repoRoot
python main.py
