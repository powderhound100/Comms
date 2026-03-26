@echo off
REM Build groundlink_radio.exe — C SDR demodulator + spectrum tool
REM Requires: MSVC Build Tools 2022 + Windows SDK + rtlsdr.lib

set "MSVC=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207"
set "SDK=C:\Program Files (x86)\Windows Kits\10"
set "SDKVER=10.0.26100.0"
set "RTLSDR=D:\tools\rtl-sdr\x64"

set "PATH=%MSVC%\bin\Hostx64\x64;%PATH%"
set "INCLUDE=%MSVC%\include;%SDK%\Include\%SDKVER%\ucrt;%SDK%\Include\%SDKVER%\um;%SDK%\Include\%SDKVER%\shared"
set "LIB=%MSVC%\lib\x64;%SDK%\Lib\%SDKVER%\ucrt\x64;%SDK%\Lib\%SDKVER%\um\x64;%RTLSDR%"

echo Building groundlink_radio.exe ...
cl.exe /O2 /W3 /Fe:groundlink_radio.exe groundlink_radio.c /I. /link rtlsdr.lib

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Build successful: groundlink_radio.exe
    echo.
    echo Runtime DLLs needed from %RTLSDR%:
    echo   rtlsdr.dll, pthreadVC2.dll, msvcr100.dll
    echo.
    echo Usage: groundlink_radio.exe --freq 94900000 --mode wfm --gain 400
    echo.
    if exist dsd-fme.exe (
        echo DSD-FME found: P25 decoding available
    ) else (
        echo WARNING: dsd-fme.exe not found - P25 decoding unavailable
        echo   Download from https://github.com/lwvmobile/dsd-fme/releases
        echo   or build from source and place dsd-fme.exe in this directory.
    )
) else (
    echo.
    echo Build FAILED.
)
