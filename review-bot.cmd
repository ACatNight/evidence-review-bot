@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\manage-windows.ps1"
if errorlevel 1 pause
