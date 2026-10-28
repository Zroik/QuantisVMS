# Cross-platform verification script for Smart VMS on Windows/PowerShell
$ErrorActionPreference = "Stop"

Write-Host "===> Running TypeScript workspace verify (typecheck, lint, test)..." -ForegroundColor Cyan
pnpm verify

Write-Host "===> Running Python ai-vision-worker verify (pytest, ruff)..." -ForegroundColor Cyan
uv run --directory services/ai-vision-worker --with pytest,ruff pytest
uv run --directory services/ai-vision-worker --with pytest,ruff ruff check .

Write-Host "===> All verification checks PASSED!" -ForegroundColor Green
