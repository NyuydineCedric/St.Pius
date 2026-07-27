@echo off
REM Compile and run the Java API (Windows). Prefer scripts\start-backend.sh on Git Bash.
setlocal
cd /d "%~dp0.."
set SRC=backend\src\main\java
set OUT=backend\bin
set DATA=%DATA_DIR%
if "%DATA%"=="" set DATA=.data
set PUBLIC=%OUT%\public

if not exist "%OUT%" mkdir "%OUT%"
if not exist "%DATA%" mkdir "%DATA%"
if not exist "%PUBLIC%" mkdir "%PUBLIC%"

dir /s /b "%SRC%\*.java" > "%OUT%\sources.txt"
javac -d "%OUT%" @"%OUT%\sources.txt"
if errorlevel 1 exit /b 1

echo Starting backend on http://127.0.0.1:8080
java -cp "%OUT%" com.reportcard.Main "%DATA%" "%PUBLIC%"
