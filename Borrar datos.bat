@echo off
REM Deja SubliApp sin datos (pide escribir BORRAR para confirmar).
REM Antes de borrar guarda una copia en SubliApp_datos\respaldos.
cd /d "%~dp0"
SubliApp.exe --borrar-datos
pause
