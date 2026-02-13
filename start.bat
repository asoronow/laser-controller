@echo off
if not exist node_modules npm install
if not exist .next npm run build

set PORT=3000

echo.
echo   Laser Controller running on port %PORT%
echo   Open http://YOUR_PC_IP:%PORT%/simulate on your phone
echo.

npx next start -H 0.0.0.0 -p %PORT%
