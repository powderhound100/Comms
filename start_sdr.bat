@echo off
title GROUNDLINK SDR Agent
echo ============================================
echo   GROUNDLINK SDR Service Agent
echo ============================================
echo.

:: RTL-SDR driver DLLs
set PATH=D:\tools\rtl-sdr\x64;%PATH%

:: Move to project directory
cd /d D:\Comms\phase7_scan_detect

:: Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found in PATH.
    pause
    exit /b 1
)

:: Check RTL-SDR DLL exists
if not exist "D:\tools\rtl-sdr\x64\rtlsdr.dll" (
    echo [WARN] rtlsdr.dll not found at D:\tools\rtl-sdr\x64
    echo        Hardware SDR modes will fail. Mock mode still works.
    echo.
)

echo Starting SDR Agent on port 8780 ...
echo Dashboard connects at http://host.docker.internal:8780
echo.
echo API endpoints:
echo   GET  http://localhost:8780/api/sdr        - Status
echo   POST http://localhost:8780/api/sdr/start  - Start mode
echo   POST http://localhost:8780/api/sdr/stop   - Stop mode
echo.
echo Press Ctrl+C to stop the agent.
echo ============================================
echo.

python sdr_agent.py --port 8780
