@echo off
cd /d "%~dp0"
echo.
echo Iniciando o sistema de votacao...
echo Pagina publica: http://localhost:5050/
echo Painel:         http://localhost:5050/admin.html
echo.
".dotnet\dotnet.exe" run --urls http://0.0.0.0:5050
pause
