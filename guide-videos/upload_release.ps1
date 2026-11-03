# Upload tutorial videos (guide-videos/out/*.mp4) as GitHub Release assets.
# The videos are distributed via Release attachments and are NOT committed to git.
#
# IMPORTANT: GitHub strips non-ASCII characters from release asset NAMES via the
# API (a Chinese filename becomes "01_.mp4" / "default.mp4"). Asset LABELS keep
# unicode, so we upload each video under an ASCII slug (temp copy) and the
# Chinese title lives in the label / docs. If labels are missing after upload,
# PATCH them via the REST API (see _rename_assets.py for a worked example).
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

# episode number prefix -> ASCII asset slug (keep in sync with out/README.md)
$slugByNum = @{
    "01" = "01-setup.mp4"
    "02" = "02-coarse-cut.mp4"
    "03" = "03-cutsame.mp4"
    "04" = "04-smart-pack.mp4"
    "05" = "05-draft-sr-decrypt.mp4"
    "06" = "06-insight-topics.mp4"
    "07" = "07-tools.mp4"
    "08" = "08-batch.mp4"
    "09" = "09-marketflow.mp4"
    "10" = "10-publish-tasks.mp4"
    "11" = "11-shortdrama-assistant.mp4"
}

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
    $num = $v.Name.Substring(0, 2)
    $slug = if ($slugByNum.ContainsKey($num)) { $slugByNum[$num] } else { $v.Name }
    Write-Host ("  - {0} -> {1}  ({2} MB)" -f $v.Name, $slug, $mb)
}
Write-Host ("Total: {0} MB" -f [math]::Round($total / 1MB, 1))

if ($DryRun) {
    Write-Host "DryRun: nothing uploaded."
    exit 0
}

foreach ($v in $videos) {
    $num = $v.Name.Substring(0, 2)
    $slug = if ($slugByNum.ContainsKey($num)) { $slugByNum[$num] } else { $v.Name }
    $tmp = Join-Path $env:TEMP $slug
    Copy-Item $v.FullName $tmp -Force
    Write-Host "Uploading $($v.Name) as $slug ..."
    gh release upload $Version $tmp --repo $Repo --clobber
    Remove-Item $tmp -Force
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Upload failed: $($v.Name)"
        exit 1
    }
}

Write-Host "Done. Verify download URLs:"
foreach ($v in $videos) {
    $num = $v.Name.Substring(0, 2)
    $slug = if ($slugByNum.ContainsKey($num)) { $slugByNum[$num] } else { $v.Name }
    Write-Host "  https://github.com/$Repo/releases/download/$Version/$slug"
}
