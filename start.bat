@echo off
setlocal

REM Launch FastAPI (serves API + frontend assets)
start "AttendanceApp" cmd /k "cd /d %~dp0 && uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload"

echo App available at http://localhost:8000
endlocal
