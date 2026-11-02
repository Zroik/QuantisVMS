@echo off
:: ============================================================================
:: Quantis VMS - WSL2 Virtual Disk Compaction Script
:: Must be run as Administrator (Right click -> Run as administrator)
:: ============================================================================
setlocal EnableDelayedExpansion

:: Check Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This script requires Administrator privileges.
    echo Please right click this file and select "Run as administrator".
    echo.
    pause
    exit /b 1
)

echo ============================================================================
echo   Quantis VMS - WSL2 Virtual Disk Compactor
echo ============================================================================
echo.
echo [1/5] Stopping WSL2 distro cleanly...
wsl --shutdown
timeout /t 3 /nobreak >nul

echo [2/5] Temporarily disabling sparse flag for DiskPart compatibility...
wsl --manage Ubuntu-24.04 --set-sparse false

echo [3/5] Compacting D:\anothervms\wsl\ext4.vhdx via diskpart...
(
echo select vdisk file="%~dp0wsl\ext4.vhdx"
echo attach vdisk readonly
echo compact vdisk
echo detach vdisk
) | diskpart

echo.
echo [4/5] Re-enabling sparse VHD mode on compacted container...
wsl --manage Ubuntu-24.04 --set-sparse true

echo.
echo [5/5] Starting Quantis VMS microservices...
wsl -u root bash -c "cd /mnt/d/anothervms && docker compose up -d"

echo.
echo ============================================================================
echo   Compaction Completed Successfully!
echo ============================================================================
pause
