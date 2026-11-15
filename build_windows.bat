@echo off
REM Compila SubliApp.exe en esta PC (requiere Python 3.10+ instalado).
REM Resultado: carpeta dist\SubliApp\ lista para copiar donde quieras.
cd /d "%~dp0"
python -m pip install -r requirements.txt pyinstaller || goto :error
pyinstaller --noconfirm SubliApp.spec || goto :error
copy /y "Borrar datos.bat" dist\SubliApp\ >nul
copy /y "LEEME.txt" dist\SubliApp\ >nul
copy /y "docs\Instructivo_SubliApp.pdf" dist\SubliApp\ >nul
echo.
echo Listo: dist\SubliApp\SubliApp.exe
pause
exit /b 0
:error
echo Hubo un error al compilar.
pause
exit /b 1
