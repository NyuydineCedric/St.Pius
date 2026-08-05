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

echo Starting backend on http://127.0.0.1:8080
java -cp "%OUT%" com.reportcard.Main "%DATA%" "%PUBLIC%"
