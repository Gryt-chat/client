; One-time migration for Gryt installations whose existing NSIS uninstaller
; cannot complete an electron-builder upgrade.
;
; The broken uninstaller lives in the OLD installation, so changing the new
; installer's process detection cannot fix it. Before electron-builder reaches
; uninstallOldVersion, move the old application directory aside and remove its
; stale uninstall registration. The new installer then sees a clean install.
;
; User data is NOT stored under $INSTDIR and is never touched here.

!include "LogicLib.nsh"

!define GRYT_MIGRATION_REG_KEY "Software\Gryt Chat"
!define GRYT_MIGRATION_REG_VALUE "LegacyNsisMigrationV1"

!macro customInit
  ; Never keep the install directory as NSIS' working directory while we move it.
  SetOutPath "$TEMP"

  ; If this machine has already crossed the broken-installer boundary, normal
  ; electron-builder upgrades should run unchanged.
  ReadRegDWORD $R1 HKCU \
    "${GRYT_MIGRATION_REG_KEY}" \
    "${GRYT_MIGRATION_REG_VALUE}"

  ${If} $R1 == 1
    Goto grytMigrationDone
  ${EndIf}

  ; Fresh machine: there is nothing to migrate.
  IfFileExists "$INSTDIR\Uninstall Gryt Chat.exe" 0 grytMigrationDone

  DetailPrint "Preparing legacy Gryt installation for upgrade..."

  StrCpy $R0 "$INSTDIR.old"

  ; If a prior failed migration left an .old directory behind, preserve that
  ; backup rather than silently overwriting it.
  IfFileExists "$R0\*.*" 0 grytNoExistingBackup

    ; Keep one older recovery copy.
    RMDir /r "$INSTDIR.old.previous"
    Rename "$R0" "$INSTDIR.old.previous"

  grytNoExistingBackup:

  ; This is the important operation proven manually:
  ;
  ;   gryt-chat -> gryt-chat.old
  ;
  ; Moving instead of deleting means a failed new install still leaves the
  ; previous application files recoverable.
  ClearErrors
  Rename "$INSTDIR" "$R0"

  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP \
      "Gryt could not prepare the existing installation for upgrade.$\r$\n$\r$\nPlease make sure Gryt is completely closed and try again."
    Abort
  ${EndIf}

  ; The poisoned old uninstaller must not be invoked after this point.
  ;
  ; Current Gryt registration.
  DeleteRegKey HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\6b194ad8-2c2d-5127-9a5d-67090636e2e2"

  ; Very old Gryt/client registration seen on machines upgraded from the
  ; original installer identity.
  DeleteRegKey HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\683825e5-efcf-57d3-b331-3f3d51300599"

  DetailPrint "Legacy Gryt installation prepared."

grytMigrationDone:
!macroend


; ── Updates (GRYT-1496) ────────────────────────────────────────────────────

; Gryt's userData folder, and the files electron/updateInProgress.ts writes there.
!define GRYT_USER_DATA "$APPDATA\${APP_FILENAME}"
!define GRYT_INSTALL_MARKER "update-installing.json"
!define GRYT_REOPEN_REQUEST "update-reopen"

; Defining customCheckAppRunning drops electron-builder's own include of these two.
!include "getProcessInfo.nsh"
Var pid

; Replaces the banner's "Installing, please wait...", and skips PowerShell unless Gryt won't close.
; A cold PowerShell took 5 s on a runner, and the stock check starts three of them.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${Silent}
    ${AndIf} ${isUpdated}
      FindWindow $0 "#32770" "" $hwndparent
      FindWindow $0 "#32770" "" $hwndparent $0
      GetDlgItem $0 $0 1000
      SendMessage $0 ${WM_SETTEXT} 0 "STR:Updating Gryt Chat. It'll open again by itself when it's done."
    ${EndIf}
  !endif

  ; An update comes from a Gryt that is quitting, so give it ten seconds to go on its own.
  ; 603 is "not running". Anything else takes electron-builder's full check.
  StrCpy $R1 0
  ${Do}
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 != 0
    ${OrIfNot} ${isUpdated}
    ${OrIf} $R1 >= 50
      ${ExitDo}
    ${EndIf}
    Sleep 200
    IntOp $R1 $R1 + 1
  ${Loop}
  ${If} $R0 != 603
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  ${EndIf}
!macroend


; Called during the successful new installation.
;
; Mark this machine as migrated so future versions go through electron-builder's
; ordinary upgrade path rather than doing another clean-install migration.
!macro customInstall
  WriteRegDWORD HKCU \
    "${GRYT_MIGRATION_REG_KEY}" \
    "${GRYT_MIGRATION_REG_VALUE}" \
    1

  ${If} ${isUpdated}
    ; Opening a shortcut while the old files sat in the uninstaller's temp folder re-points it
    ; there, and that folder is gone by now. Aim both at the new exe again.
    ${If} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
    ${If} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${EndIf}

    ; A launch during an install on quit asked to be started once this finishes.
    ${If} ${FileExists} "${GRYT_USER_DATA}\${GRYT_REOPEN_REQUEST}"
      Delete "${GRYT_USER_DATA}\${GRYT_REOPEN_REQUEST}"
      ${If} ${Silent}
      ${AndIfNot} ${isForceRun}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      ${EndIf}
    ${EndIf}

    ; A restart to update: start Gryt and keep this window up until Gryt's shows, when it deletes
    ; the marker. Quitting then skips the stock start, which stays as a retry if it never shows.
    ${IfNot} ${Silent}
    ${AndIf} ${FileExists} "${GRYT_USER_DATA}\${GRYT_INSTALL_MARKER}"
      System::Call 'user32::AllowSetForegroundWindow(i -1)'
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      StrCpy $R9 0
      ${Do}
        Sleep 250
        IntOp $R9 $R9 + 1
        ${IfNot} ${FileExists} "${GRYT_USER_DATA}\${GRYT_INSTALL_MARKER}"
          !insertmacro quitSuccess
        ${EndIf}
      ${LoopWhile} $R9 < 80
    ${EndIf}
  ${EndIf}
!macroend
