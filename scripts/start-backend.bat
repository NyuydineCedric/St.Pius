@echo off
REM Compile and run the Java API (Windows). Prefer scripts\start-backend.sh on Git Bash.
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
set SRC=backend\src\main\java
set OUT=backend\bin
set DATA=%DATA_DIR%
if "%DATA%"=="" set DATA=.data
set PUBLIC=%OUT%\public

if not exist "%OUT%" mkdir "%OUT%"
if not exist "%DATA%" mkdir "%DATA%"
if not exist "%PUBLIC%" mkdir "%PUBLIC%"

REM javac's @argfile parser treats backslash as an escape character, which
REM mangles ordinary Windows paths (e.g. "\r" gets read as carriage return).
REM Writing paths with forward slashes instead sidesteps that entirely —
REM Windows/javac accept forward slashes in file paths just fine.
if exist "%OUT%\sources.txt" del "%OUT%\sources.txt"
for /f "delims=" %%f in ('dir /s /b "%SRC%\*.java"') do (
  set "srcfile=%%f"
  echo "!srcfile:\=/!">> "%OUT%\sources.txt"
)
javac -d "%OUT%" @"%OUT%\sources.txt"
if errorlevel 1 exit /b 1

REM Rebuild the frontend and sync it into the backend's static folder every
REM time this runs. Without this step the compiled backend keeps serving
REM whichever frontend snapshot happened to land in %PUBLIC% the first time
REM the script ran, so UI changes silently never show up even after the
REM Java side recompiles cleanly.
echo Building frontend...
call npm run build
if errorlevel 1 exit /b 1
if exist "%PUBLIC%" rmdir /s /q "%PUBLIC%"
mkdir "%PUBLIC%"
xcopy "dist" "%PUBLIC%" /E /I /Y >nul

echo Starting backend on http://127.0.0.1:8080
java -cp "%OUT%" com.reportcard.Main "%DATA%" "%PUBLIC%"
