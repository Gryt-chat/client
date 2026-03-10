@echo off
setlocal

set "NATIVE_DIR=%~dp0"
set "OUT_DIR=%NATIVE_DIR%..\build\native"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

where cl.exe >nul 2>&1
if %errorlevel% equ 0 goto :build

echo cl.exe not found, looking for Visual Studio...

for %%p in ("%ProgramFiles%" "%ProgramFiles(x86)%") do (
    for %%y in (2022 2019 18 17) do (
        for %%e in (Community Professional Enterprise BuildTools) do (
            if exist "%%~p\Microsoft Visual Studio\%%y\%%e\VC\Auxiliary\Build\vcvarsall.bat" (
                echo Found: %%~p\Microsoft Visual Studio\%%y\%%e
                call "%%~p\Microsoft Visual Studio\%%y\%%e\VC\Auxiliary\Build\vcvarsall.bat" x64
                goto :build
            )
        )
    )
)

echo ERROR: Could not find Visual Studio or cl.exe.
echo Install "Desktop development with C++" workload, or run from a Developer Command Prompt.
exit /b 1

:build
echo.
echo === Building audio-capture.exe ===
cl.exe /EHsc /O2 /DUNICODE /D_UNICODE ^
    /Fe:"%OUT_DIR%\audio-capture.exe" ^
    "%NATIVE_DIR%audio-capture\windows\main.cpp" ^
    ole32.lib user32.lib
if %errorlevel% neq 0 (
    echo BUILD FAILED: audio-capture.exe
    exit /b 1
)
del main.obj 2>nul
echo SUCCESS: audio-capture.exe

echo.
echo === Building screen-capture.exe ===
cl.exe /EHsc /O2 ^
    /I"%NATIVE_DIR%screen-capture\windows" ^
    /Fe:"%OUT_DIR%\screen-capture.exe" ^
    "%NATIVE_DIR%screen-capture\windows\main.cpp" ^
    /link d3d11.lib dxgi.lib ws2_32.lib bcrypt.lib mf.lib mfplat.lib mfuuid.lib ole32.lib oleaut32.lib propsys.lib
if %errorlevel% neq 0 (
    echo BUILD FAILED: screen-capture.exe
    exit /b 1
)
del main.obj 2>nul
echo SUCCESS: screen-capture.exe

echo.
echo All native binaries built successfully.
