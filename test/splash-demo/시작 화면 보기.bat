@echo off
cd /d "%~dp0..\.."
start "" "desktop\node_modules\electron\dist\electron.exe" "test\splash-demo"
