@echo off
rem ccs for Windows: run bin\ccs with the Python launcher (py), or python when py is missing.
where /q py.exe
if errorlevel 1 goto usepython
py -3 "%~dp0ccs" %*
exit /b %errorlevel%
:usepython
python "%~dp0ccs" %*
exit /b %errorlevel%
