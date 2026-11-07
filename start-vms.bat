@echo off
setlocal
cd /d "%~dp0"
title Quantis Starter
echo ========================================================
echo                  QUANTIS - STARTER
echo ========================================================
echo.
echo Menjalankan layanan Quantis di latar belakang...

:: Start host RAM and ONVIF publisher in background if node is present
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start /b "" node scripts\host-ram-publisher.mjs >nul 2>&1
)

where docker >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    docker compose up -d
) else (
    wsl bash -c "docker compose up -d"
)

echo.
echo ========================================================
echo [BERHASIL] Seluruh layanan Quantis telah aktif!
echo Dashboard Web: http://localhost:8080
echo ========================================================
echo.
pause
