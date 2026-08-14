# Older Gryt clients start the new NSIS installer before their Electron process
# has fully exited. This code is compiled into the new installer, so it can
# repair an update even though the client launching it is still old.
#
# electron-builder 26.8's fallback process lookup is a substring match. It can
# therefore find the setup process itself ("Gryt Chat Setup ...") while looking
# for "Gryt Chat.exe" and display a retry dialog that can never succeed. Keep
# the macOS-proven builder, but backport electron-builder's exact tasklist +
# anchored findstr lookup from its upstream fix.
!include "getProcessInfo.nsh"
Var pid

!macro GRYT_FIND_PROCESS_EXACT _FILE _RETURN
  nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${_FILE}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${_FILE}\""`
  Pop ${_RETURN}
!macroend

!macro customCheckAppRunning
  Sleep 5000
  !insertmacro IS_POWERSHELL_AVAILABLE

  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    !insertmacro GRYT_FIND_PROCESS_EXACT "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      ${if} ${isUpdated}
        Sleep 1000
        Goto grytStopProcess
      ${endIf}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK grytStopProcess
      Quit

      grytStopProcess:
      DetailPrint "$(appClosing)"
      !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0
      Sleep 300
      StrCpy $R1 0

      grytWaitForExit:
        IntOp $R1 $R1 + 1
        !insertmacro GRYT_FIND_PROCESS_EXACT "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          Sleep 1000
          !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
          !insertmacro GRYT_FIND_PROCESS_EXACT "${APP_EXECUTABLE_FILENAME}" $R0
          ${if} $R0 == 0
            DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
            Sleep 2000
          ${else}
            Goto grytNotRunning
          ${endIf}
        ${else}
          Goto grytNotRunning
        ${endIf}

        ${if} $R1 > 1
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY grytWaitForExit
          Quit
        ${else}
          Goto grytWaitForExit
        ${endIf}
      grytNotRunning:
    ${endIf}
  ${endIf}
!macroend
