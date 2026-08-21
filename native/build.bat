@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
rem One .. , not two. This file sits at native\build.bat, one level below the
rem client root, while native\audio-capture\build.sh is two and correctly uses
rem ..\.., because the path was copied across without adjusting for the depth.
rem Two took the helpers to packages\build\native, which nothing looks in.
rem
rem It went unnoticed because build\native\ used to be committed, so the
rem beforeBuild guard found the tracked copies and electron-builder packaged
rem those. GRYT-419 stopped tracking them and the next Windows release failed.
set "OUT_DIR=%SCRIPT_DIR%..\build\native"

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

where cl.exe >nul 2>&1
if %errorlevel% neq 0 (
    echo cl.exe not found, searching for Visual Studio...
    set "FOUND_VS="
    for %%p in ("%ProgramFiles%" "%ProgramFiles(x86)%") do (
        for %%y in (2022 2019 18 17) do (
            for %%e in (Community Professional Enterprise BuildTools) do (
                if exist "%%~p\Microsoft Visual Studio\%%y\%%e\VC\Auxiliary\Build\vcvarsall.bat" (
                    echo Found: %%~p\Microsoft Visual Studio\%%y\%%e
                    call "%%~p\Microsoft Visual Studio\%%y\%%e\VC\Auxiliary\Build\vcvarsall.bat" x64
                    set "FOUND_VS=1"
                    goto :build
                )
            )
        )
    )
    if not defined FOUND_VS (
        echo ERROR: Could not find Visual Studio or cl.exe.
        echo Install \"Desktop development with C++\" workload, or run this from a Developer Command Prompt.
        exit /b 1
    )
)

:build
echo Building audio-capture.exe ...
cl.exe /EHsc /O2 /DUNICODE /D_UNICODE /Fe:"%OUT_DIR%\audio-capture.exe" ^
    "%SCRIPT_DIR%audio-capture\windows\main.cpp" ^
    ole32.lib user32.lib
if %errorlevel% neq 0 (
    echo BUILD FAILED: audio-capture.exe
    exit /b 1
)
del audio-capture.exe 2>nul
del main.obj 2>nul
echo SUCCESS: audio-capture.exe

echo Building screen-capture.exe ...
cl.exe /EHsc /O2 /I"%SCRIPT_DIR%screen-capture\windows" /Fe:"%OUT_DIR%\screen-capture.exe" ^
    "%SCRIPT_DIR%screen-capture\windows\main.cpp" ^
    /link d3d11.lib dxgi.lib ws2_32.lib bcrypt.lib mf.lib mfplat.lib mfuuid.lib ole32.lib oleaut32.lib propsys.lib
if %errorlevel% neq 0 (
    echo BUILD FAILED: screen-capture.exe
    exit /b 1
)
del screen-capture.exe 2>nul
del main.obj 2>nul

rem Fail here rather than three steps later. cl.exe happily writes into
rem whatever directory this script created, so a wrong OUT_DIR exits 0 and the
rem release only falls over in electron-builder's beforeBuild guard, with an
rem error that names the directory it wanted and not the one we wrote to.
for %%f in ("%OUT_DIR%\audio-capture.exe" "%OUT_DIR%\screen-capture.exe") do (
    if not exist "%%~f" (
        echo BUILD FAILED: expected %%~f to exist
        exit /b 1
    )
)

echo SUCCESS: All native binaries built and placed in %OUT_DIR%
endlocal
