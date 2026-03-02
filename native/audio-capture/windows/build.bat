@echo off
setlocal

:: Build audio-capture.exe with MSVC
:: Run from: "x64 Native Tools Command Prompt for VS" or "Developer Command Prompt"
:: Or just double-click — the script will try to find vcvarsall.bat automatically.

where cl.exe >nul 2>&1
if %errorlevel% neq 0 (
    echo cl.exe not found, looking for Visual Studio...
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
        echo Install "Desktop development with C++" workload, or run this from
        echo a Developer Command Prompt.
        exit /b 1
    )
)

:build
echo.
echo Building audio-capture.exe ...
cl.exe /EHsc /O2 /DUNICODE /D_UNICODE /Fe:audio-capture.exe "%~dp0main.cpp" ole32.lib user32.lib
if %errorlevel% neq 0 (
    echo.
    echo BUILD FAILED
    exit /b 1
)

set "DEST=%~dp0..\..\..\build\native"
if not exist "%DEST%" mkdir "%DEST%"
copy /Y audio-capture.exe "%DEST%\audio-capture.exe" >nul

del audio-capture.exe 2>nul
del audio-capture.obj 2>nul

echo.
echo SUCCESS: audio-capture.exe built and copied to build\native\
echo.
