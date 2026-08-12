@echo off
setlocal
cd /d "%~dp0"
set "TRAINER=..\dark-chess-b200-gpu-trainer"
set "PYTHON=%TRAINER%\.venv\Scripts\python.exe"
set "INPUT=%TRAINER%\training-gpu\final_model.pt"
set "OUTPUT=final_model.onnx"

if not exist "%PYTHON%" goto missing_python
if not exist "%INPUT%" goto missing_model

"%PYTHON%" -c "import onnx" >nul 2>nul
if errorlevel 1 "%PYTHON%" -m pip install onnx
if errorlevel 1 goto failed

"%PYTHON%" tools\export_final_model.py "%INPUT%" "%OUTPUT%"
if errorlevel 1 goto failed

echo.
echo Export completed: "%CD%\%OUTPUT%"
pause
exit /b 0

:missing_python
echo Trainer Python was not found: "%PYTHON%"
pause
exit /b 1

:missing_model
echo final_model.pt was not found: "%INPUT%"
pause
exit /b 1

:failed
echo Export failed. Read the error shown above.
pause
exit /b 1
