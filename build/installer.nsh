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

Var grytMigrationBackup
Var grytMigrationMarker

!macro customInit
  ; Never keep the install directory as NSIS' working directory while we move it.
  SetOutPath "$TEMP"

  ; If this machine has already crossed the broken-installer boundary, normal
  ; electron-builder upgrades should run unchanged.
  ReadRegDWORD $grytMigrationMarker HKCU \
    "${GRYT_MIGRATION_REG_KEY}" \
    "${GRYT_MIGRATION_REG_VALUE}"

  ${If} $grytMigrationMarker == 1
    Goto grytMigrationDone
  ${EndIf}

  ; Fresh machine: there is nothing to migrate.
  IfFileExists "$INSTDIR\Uninstall Gryt Chat.exe" 0 grytMigrationDone

  DetailPrint "Preparing legacy Gryt installation for upgrade..."

  StrCpy $grytMigrationBackup "$INSTDIR.old"

  ; If a prior failed migration left an .old directory behind, preserve that
  ; backup rather than silently overwriting it.
  IfFileExists "$grytMigrationBackup\*.*" 0 grytNoExistingBackup

    ; Keep one older recovery copy.
    RMDir /r "$INSTDIR.old.previous"
    Rename "$grytMigrationBackup" "$INSTDIR.old.previous"

  grytNoExistingBackup:

  ; This is the important operation proven manually:
  ;
  ;   gryt-chat -> gryt-chat.old
  ;
  ; Moving instead of deleting means a failed new install still leaves the
  ; previous application files recoverable.
  ClearErrors
  Rename "$INSTDIR" "$grytMigrationBackup"

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


; Called during the successful new installation.
;
; Mark this machine as migrated so future versions go through electron-builder's
; ordinary upgrade path rather than doing another clean-install migration.
!macro customInstall
  WriteRegDWORD HKCU \
    "${GRYT_MIGRATION_REG_KEY}" \
    "${GRYT_MIGRATION_REG_VALUE}" \
    1
!macroend