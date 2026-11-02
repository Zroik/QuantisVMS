@echo off
setlocal
cd /d "%~dp0"
title Quantis Starter
echo ========================================================
echo                  QUANTIS - STARTER
echo ========================================================
echo.
echo Menjalankan layanan Quantis di latar belakang...

where docker >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    docker compose up -d
) else (
    wsl bash -c "docker compose up -d"
)

echo.
echo ========================================================
echo [BERHASIL] Seluruh layanan Quantis telah aktif!
echo Dashboard Web: http://localhost:8080 (atau http://localhost:5173)
echo ========================================================
echo.
pause
