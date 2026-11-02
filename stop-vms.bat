@echo off
setlocal
cd /d "%~dp0"
title Quantis Stopper
echo ========================================================
echo                  QUANTIS - STOPPER
echo ========================================================
echo.
echo [1/2] Menghentikan seluruh kontainer Docker (graceful down)...

where docker >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    docker compose down
) else (
    wsl bash -c "docker compose down"
)

echo.
echo [2/2] Mematikan mesin WSL2 dan mengembalikan RAM ke Windows...
wsl --shutdown

echo.
echo ========================================================
echo [BERHASIL] Seluruh layanan berhenti dan RAM telah dibebaskan!
echo Proses vmmemWSL telah dimatikan sepenuhnya.
echo ========================================================
echo.
pause
