@echo off
echo ============================================
echo  GROUNDLINK Multi-SDR Startup (Windows Side)
echo ============================================
echo.

REM Kill any existing SDR agent
echo [1/2] Stopping old SDR agent...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8780.*LISTENING"') do (
    taskkill /PID %%a /T /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM Start updated SDR agent in adsb_dual mode
echo [2/2] Starting SDR agent (dual ADS-B mode)...
start "GROUNDLINK SDR Agent" cmd /c "cd /d D:\Comms\phase7_scan_detect && python sdr_agent.py --port 8780"
timeout /t 4 /nobreak >nul

REM Switch to dual mode
curl -s -X POST http://localhost:8780/api/sdr/start -H "Content-Type: application/json" -d "{\"mode\": \"adsb_dual\"}" >nul 2>&1

echo.
echo SDR Agent running on http://localhost:8780
echo ADS-B bridge listening on ports 9001 + 9002
echo WebSocket on ws://localhost:8771
echo.
echo Pi status: curl http://10.0.0.245:8781/api/pi/health
echo Dashboard: http://localhost:3001/ads-b
echo.
pause
