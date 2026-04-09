$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $repoRoot "static"
$targetDir = Join-Path $repoRoot "docs"

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -Path (Join-Path $sourceDir "*") -Destination $targetDir -Recurse -Force
New-Item -ItemType File -Force -Path (Join-Path $targetDir ".nojekyll") | Out-Null

Write-Output "Static PWA copied to docs/"
