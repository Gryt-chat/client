@echo off
setlocal
set SCRIPT_DIR=%~dp0
set OUT_DIR=%SCRIPT_DIR%..\..\..\build\native

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

where cl.exe >nul 2>&1
if %ERRORLEVEL% equ 0 goto :build

echo cl.exe not found, searching for MSVC environment...

rem Try vswhere first
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VCVARS="
if exist "%VSWHERE%" (
    set "TMPFILE=%TEMP%\vcvars_path.txt"
    "%VSWHERE%" -latest -products * -find "VC\Auxiliary\Build\vcvarsall.bat" > "%TMPFILE%" 2>nul
    set /p VCVARS=<"%TMPFILE%"
    del "%TMPFILE%" >nul 2>&1
)

rem Fallback: scan common locations
if not defined VCVARS (
    for %%d in (
        "%ProgramFiles%\Microsoft Visual Studio\2022\Community"
        "%ProgramFiles%\Microsoft Visual Studio\2022\Professional"
        "%ProgramFiles%\Microsoft Visual Studio\2022\Enterprise"
        "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools"
        "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
        "%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools"
        "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\Community"
        "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\BuildTools"
    ) do (
        if exist "%%~d\VC\Auxiliary\Build\vcvarsall.bat" (
            set "VCVARS=%%~d\VC\Auxiliary\Build\vcvarsall.bat"
            goto :found
        )
    )
)

:found
if not defined VCVARS (
    echo ERROR: Could not find vcvarsall.bat. Install "Desktop development with C++" via Visual Studio Installer.
    exit /b 1
)
echo Found: %VCVARS%
call "%VCVARS%" amd64
if %ERRORLEVEL% neq 0 (
    echo ERROR: vcvarsall.bat failed
    exit /b 1
)

:build
echo Building screen-capture.exe (MSVC)...
cl.exe /EHsc /O2 /I"%SCRIPT_DIR%" /Fe:"%OUT_DIR%\screen-capture.exe" "%SCRIPT_DIR%main.cpp" /link d3d11.lib dxgi.lib ws2_32.lib bcrypt.lib mf.lib mfplat.lib mfuuid.lib ole32.lib propsys.lib

if %ERRORLEVEL% neq 0 (
    echo Build FAILED
    exit /b 1
)
echo Built: %OUT_DIR%\screen-capture.exe
