@echo off
cd /d "%~dp0"
echo Starting EMS training simulator...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if errorlevel 1 pause
