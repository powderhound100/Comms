@echo off
REM Build groundlink_radio.exe — C SDR demodulator + spectrum tool
REM Requires: MSVC cl.exe (via VS Developer Command Prompt) + rtlsdr.lib

set RTLSDR=D:\tools\rtl-sdr\x64

echo Building groundlink_radio.exe ...
cl.exe /O2 /W3 /Fe:groundlink_radio.exe groundlink_radio.c /I. /link /LIBPATH:%RTLSDR% rtlsdr.lib

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Build successful: groundlink_radio.exe
    echo.
    echo Runtime DLLs needed from %RTLSDR%:
    echo   rtlsdr.dll, pthreadVC2.dll, msvcr100.dll
    echo.
    echo Usage: groundlink_radio.exe --freq 94900000 --mode wfm --gain 400
) else (
    echo.
    echo Build FAILED. Make sure you are running from a VS Developer Command Prompt.
)
