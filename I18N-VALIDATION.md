# Localization validation

Based on client `3d4072c3202ff6d5346651299c02f98210efd9e3` (1.13.22).
Implemented with Codex assistance; the commits include the corresponding trailer.

TypeScript and ESLint pass. The PR checkout passes all 16 selected source and
behavior checks: locale consistency, settings index, voice presence, welcome
tour, embedded-starting wording, server management/join/hover wording, service
status, plugin wording, composer Enter, terms agreement, hotkeys, permissions
and both reconnect checks. The locale suite checks 506 matching keys, variables,
component tags, fallback, system detection, storage and plural forms.

Six headless Playwright tests pass with one worker. They exercise the actual
language selector, persistence, storage failures, system changes, late desktop
storage hydration, an already-open invite/error dialog, Chinese settings search,
guest nickname input and composer IME events at desktop and narrow widths.
Simulated composition events do not establish OS-native IME support. Real media,
SFU/TURN calls, native PTT hooks, Electron execution and updater installation
have not been accepted by these checks.

An initial broad run reached 158/170 checks on Windows with Node 22.23.2 after
related test updates and permitted loopback rechecks. This was not a green suite.
Two subsequent checks pass: runtime-cleanup outside the restricted sandbox and
local-archive with Node 24.10.0 (23/23 assertions on both baseline and modified
source). The remaining results are listed below. Scripts were compared with the
original checkout; all twelve platform-check scripts are unchanged by this PR.

| Check | Baseline evidence and remaining limit |
| --- | --- |
| windows-signature | Both fail because the fake signer runs Unix `true`, absent on Windows (`ENOENT`). No signing acceptance is claimed. |
| embedded-server-paths | Standalone baseline passes; the linked independent client worktree is mistaken for a superproject and expects absent server/SFU/worker siblings. The unchanged script and embedded-build resolver share that assumption. No full embedded-server build was performed. |
| embedded-version | Both fail at the Unix shell command containing `>/dev/null 2>&1 \|\| true`; the restricted run had additionally blocked scratch Git initialization. |
| embedded-sfu-ports | Both fail the second simulated restart assertion: recorded free ports are reassigned. This is an existing Windows result in unchanged embedded-manager/config source; its root cause remains unverified. |
| embedded-runtime-cleanup | Restricted run cannot create the scratch symlink. Both baseline and modified checks pass when that permission is available. Windows readonly cases are explicitly skipped upstream. |
| local-archive | Node 22 lacks the expected Web Locks. Both baseline and modified source pass all 23 checks with Node 24.10.0. |
| webhook-cards | Both fail a source-path assertion: Windows `src\\...` versus expected `src/...`. |
| examples | Both fail all eleven example imports because Windows absolute paths are passed as ESM specifiers instead of file URLs. |
| presence-helper | Both fail: a Unix fixture path is compared against a Windows path, then a Unix-style helper socket cannot listen on Windows (`EACCES`). |
| helper-startup | Both fail the Linux fixture's unescaped regular expression around a Windows backslash path. Other mocked platform assertions pass. |
| appimage-location | Excluded from further execution: its unchanged fixture writes into the real home Trash/Applications directories. The original restricted run failed outside the workspace. Production AppImage-location source is unchanged. Linux acceptance remains open. |
| ai-toolkit | Both fail the Windows separator assertion (`src\\main.tsx` versus `src/main.tsx`). |

The untranslated areas and hardcoded `@gryt/ui` labels are recorded in
`I18N-DEVELOPMENT.md`. Runtime server text, user content, names and protocol/error
identifiers remain outside the translation resources. Locale switching for some
previously emitted toast text remains an open coverage gap.
