@echo off
chcp 65001 >nul
title Selin - Cloudflare Direct Deploy

echo ==============================================
echo       Selin - Cloudflare Direct Deploy
echo ==============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version of Node.js, then run this file again.
  pause
  exit /b 1
)

echo [1/4] Installing project packages...
call npm install
if errorlevel 1 goto :error

echo.
echo [2/4] Signing in to Cloudflare...
echo A browser window will open. Sign in to the Cloudflare account you want to use.
call npx wrangler login
if errorlevel 1 goto :error

echo.
echo [3/4] Verifying the active Cloudflare account...
call npx wrangler whoami
if errorlevel 1 goto :error

echo.
echo Review the account shown above.
echo Press any key to deploy Selin to this account, or close this window to cancel.
pause >nul

echo.
echo [4/4] Building and deploying Selin...
call npm run deploy
if errorlevel 1 goto :error

echo.
echo ==============================================
echo Deployment completed successfully.
echo Copy the workers.dev URL shown above.
echo ==============================================
pause
exit /b 0

:error
echo.
echo Deployment stopped because an error occurred.
echo Send a screenshot of the full error message.
pause
exit /b 1
