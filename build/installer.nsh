# Older Gryt clients start the new NSIS installer before their Electron process
# has fully exited. Give that process tree time to finish, then run
# electron-builder's normal path-aware check. This macro is compiled into the
# new installer, so it also repairs an update launched by an older Gryt client.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  Sleep 5000
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend
