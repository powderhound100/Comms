# Build groundlink_radio.exe using MSVC Build Tools

$msvc = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207"
$sdk = "C:\Program Files (x86)\Windows Kits\10"
$sdkVer = "10.0.26100.0"
$rtlsdr = "D:\tools\rtl-sdr\x64"

$env:PATH = "$msvc\bin\Hostx64\x64;$env:PATH"
$env:INCLUDE = "$msvc\include;$sdk\Include\$sdkVer\ucrt;$sdk\Include\$sdkVer\um;$sdk\Include\$sdkVer\shared"
$env:LIB = "$msvc\lib\x64;$sdk\Lib\$sdkVer\ucrt\x64;$sdk\Lib\$sdkVer\um\x64;$rtlsdr"

Set-Location D:\Comms\phase7_scan_detect

Write-Host "=== Building groundlink_radio.exe ==="

# Run cl.exe — it writes banner to stderr which is normal
$ErrorActionPreference = "Continue"
& cl.exe /O2 /W3 /Fe:groundlink_radio.exe groundlink_radio.c /I. /link rtlsdr.lib 2>&1 | Out-Host
$ErrorActionPreference = "Stop"

Write-Host ""
if (Test-Path "groundlink_radio.exe") {
    Write-Host "BUILD SUCCESS"
    $f = Get-Item groundlink_radio.exe
    Write-Host "  Size: $($f.Length) bytes"
    Write-Host "  Date: $($f.LastWriteTime)"
} else {
    Write-Host "BUILD FAILED"
    exit 1
}
