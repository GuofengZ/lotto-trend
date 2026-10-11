@echo off
chcp 65001 >nul
title 双色球 / 大乐透 开奖号码筛选器
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 未检测到 Node.js
  echo   请先安装 Node.js（https://nodejs.org/zh-cn），安装后重新双击本文件。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动服务，启动后浏览器会自动打开，请不要关闭本窗口。
echo   关闭本窗口 = 停止服务。
echo.

start "" http://localhost:8788/
node server.js

echo.
echo   服务已停止。
pause