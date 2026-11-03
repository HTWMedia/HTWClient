# Upload tutorial videos (guide-videos/out/*.mp4) as GitHub Release assets.
# The videos are distributed via Release attachments and are NOT committed to git.
#
# Usage:
#   pwsh ./upload_release.ps1 -Version v0.5.0            # upload
#   pwsh ./upload_release.ps1 -Version v0.5.0 -DryRun    # list only
#
# Prerequisite: gh CLI installed and logged in (gh auth login -h github.com)
param(
    [string]$Version = "v0.5.0",
    [string]$Repo = "HTWMedia/HTWClient",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "out"
$videos = Get-ChildItem $dir -Filter *.mp4 | Sort-Object Name
if (-not $videos) {
    Write-Error "No .mp4 found in $dir"
    exit 1
}

Write-Host "Found $($videos.Count) videos to upload to $Repo@$Version :"
$total = 0
foreach ($v in $videos) {
    $mb = [math]::Round($v.Length / 1MB, 1)
    $total += $v.Length
    Write-Host ("  - {0}  ({1} MB)" -f $v.Name, $mb)
}
Write-Host ("Total: {0} MB" -f [math]::Round($total / 1MB, 1))

if ($DryRun) {
    Write-Host "DryRun: nothing uploaded."
    exit 0
}

foreach ($v in $videos) {
    Write-Host "Uploading $($v.Name) ..."
    gh release upload $Version $v.FullName --repo $Repo --clobber
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Upload failed: $($v.Name)"
        exit 1
    }
}

Write-Host "Done. Verify download URLs:"
foreach ($v in $videos) {
    $url = "https://github.com/$Repo/releases/download/$Version/" + [uri]::EscapeDataString($v.Name)
    Write-Host "  $url"
}
