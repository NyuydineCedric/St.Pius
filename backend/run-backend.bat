@echo off
setlocal
set BASE=%~dp0
set SRC=%BASE%src\main\java
set BIN=%BASE%bin
if not exist "%BIN%" mkdir "%BIN%"
javac -d "%BIN%" "%SRC%\com\reportcard\Main.java"
if errorlevel 1 (
  echo Compilation failed.
  exit /b 1
)
java -cp "%BIN%" com.reportcard.Main
