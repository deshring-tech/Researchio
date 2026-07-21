@echo off
setlocal

:: Researchio launcher.
::
:: Runs first-time setup when needed, then starts the dev server and opens a
:: browser. Port 4321 avoids clashing with anything already on 3000.

set PORT=4321

if not exist "node_modules\" (
  echo Installing dependencies. This takes a minute the first time...
  call npm install || goto :failed
)

if not exist ".env" (
  echo Creating .env from .env.example...
  copy ".env.example" ".env" >nul
  echo.
  echo   Edit .env to add GEMINI_API_KEY and enable AI features.
  echo   The app runs without one, with AI disabled.
  echo.
)

:: Applies any pending migrations. Safe to run every time.
echo Preparing the database...
call npx prisma migrate deploy >nul 2>&1 || goto :failed
call npx prisma generate >nul 2>&1 || goto :failed

echo.
echo Starting Researchio on http://localhost:%PORT%
echo Press Ctrl+C to stop.
echo.

:: Open the browser shortly after, so the server has a moment to bind.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:%PORT%"

call npm run dev -- -p %PORT%
goto :eof

:failed
echo.
echo Setup failed. Run the commands in README.md manually to see the error.
pause
exit /b 1
