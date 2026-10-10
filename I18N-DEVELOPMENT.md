# English and Simplified Chinese UI

Modified on 2026-10-10 with AI assistance (Codex). This local work is based on
Gryt client `3d4072c3202ff6d5346651299c02f98210efd9e3` (v1.13.22) and the
unchanged UI source `3d88e6ae12178faeb48f9a30071a5825fd4ed13d` (`@gryt/ui` 0.44.0).
The client copyright and AGPL-3.0-or-later license remain in `LICENSE`; the UI
copyright and MIT license remain in its corresponding source archive.

## Framework choice

| Option | Tradeoff |
| --- | --- |
| React Context with a small JSON lookup | Fewer dependencies, but fallback, interpolation, plural selection, storage events and reactive dialogs would become app-maintained code. |
| i18next + react-i18next | Adds dependencies and uses the established JSON resource, fallback, plural and React subscription APIs. Fits the community translation format requested in Gryt issue 26. |

This implementation uses i18next 26.4.2 and react-i18next 17.0.16 as locked in
`yarn.lock`. Resources are bundled locally. There is no translation service,
remote resource loader, detector plugin or addon-based DOM replacement.
See [i18next configuration](https://www.i18next.com/overview/configuration-options)
and [react-i18next](https://react.i18next.com/latest/usetranslation-hook).

## Language behavior

`src/packages/i18n/locales/en.json` and `zh-CN.json` contain matching nested
key-value dictionaries. Keys are identifiers: change copy at an existing key
rather than renaming it when the English wording changes. Keep interpolation
variables, plural suffixes and `Trans` component tags consistent between files.

The initial preference is `system`. The first supported entry in
`navigator.languages` is used: English variants map to `en`; `zh`, `zh-CN`,
`zh-SG` and `zh-Hans` variants map to `zh-CN`. Other languages fall back to
English; traditional Chinese does not claim to be a supported translation.
An explicit selection overrides system changes. The preference lives in
`localStorage["gryt.ui.language"]`, separately from identity and server data.
Storage failures still allow the session to switch. Storage events update other
windows, and `languagechange` updates the system preference. `html.lang` follows
the resolved language. Desktop startup reads the preference again after the
existing file-store hydration and before React renders. The selector is in
Appearance → Display.

English is the resource fallback. Text components subscribe through
`useTranslation`; invitation errors keep their locale key in state so a dialog
already open can change language. Server-provided messages and unknown errors
remain intact. Error codes, protocol enums, user messages, nicknames, server and
channel names, OS device labels, emoji identifiers and aliases are not translated.

Setting anchors are explicit for translated settings. Search includes localized
copy and the original English terms; a translated title must not become an anchor
ID. Components that accept labels receive translated props. There is no patch to
the installed UI package.

## Covered entry points

- Guest welcome, local nickname and identity settings, adding a server and
  accepting an invite, leaving or removing a server.
- Main navigation, channel controls, chat editor and its labels, read-only and
  waiting states, basic message actions, emoji search and empty state.
- Input/output device selection, existing volume/noise gate/processing settings,
  PTT labels and hotkeys, mute/deafen/camera/share controls and common permission
  warnings. Only copy changed in existing audio controls; no loudness feature or
  audio-processing behavior was added.
- Reconnect and loading states, account startup wait, browser notice, posting
  consent prompt, common settings and translated settings search results.
- IME Enter guards in chat, autocomplete, nickname/activity editing and settings
  search. Ordinary Enter and Shift+Enter behavior in chat are retained.

## Remaining coverage

This is an initial migration, not a claim that every screen is translated.
Server administration/roles, member context menus and voice participant cards,
DM/call-specific dialogs, theme editor, camera/screen settings panels, notification
and desktop/advanced settings, reporting/moderation, recovery/pairing/security
dialogs, rich presence, custom-sound/layout subcomponents, release notes and
service-status announcements still have English copy. Some dynamic profile
upload/status messages and sidebar merge explanations also remain English.

`@gryt/ui` has hardcoded EmojiPicker search-result count, search-results heading
and accessibility labels, spinner `Loading`, and avatar/designer dialog copy.
Emoji category labels still come from the upstream English data. Those need a
separate UI label-prop patch; removing or replacing DOM after render is not a
supported localization approach. Search metadata for panels not migrated and a
few descriptions that differ from the panel copy still fall back to English.

The localization change retains upstream branding and desktop packaging. The
language preference has its own key; identity, authentication, server discovery,
audio processing and update behavior are outside this UI migration.

## Reproduce the checks and Web build

Use LF checkout text on Windows (`git config core.autocrlf false` before checkout);
several existing source checks assume LF. The measured environment used Node
22.23.2 and Yarn Classic 1.22.22. Some upstream tests require Node 24 or Unix
facilities; they are not silently treated as passing on this machine.

```powershell
$env:UV_THREADPOOL_SIZE = '2'
$env:CHILD_CONCURRENCY = '1'
$env:GOMAXPROCS = '2'
$env:RAYON_NUM_THREADS = '2'
yarn install --frozen-lockfile --ignore-scripts --network-concurrency 2
yarn typecheck
yarn lint
yarn test:i18n
yarn e2e:i18n
Remove-Item Env:ELECTRON -ErrorAction SilentlyContinue
yarn build
```

The install deliberately skips Electron/native postinstall scripts for the Web
test build. The localization e2e config
uses one headless worker, a loopback Vite service on 4777 and mocked external
requests. Its fresh browser context does not use installed-client data, and its
full-page test rejects media acquisition. No actual microphone, speaker, camera,
screen sharing, SFU call, native PTT hook, OS IME, installer or updater is exercised.

`scripts/check-i18n.mjs` verifies locale parity, nonempty translations, placeholder
and component-tag parity, literal source keys, system detection, invalid/blocked
storage reads, fallback, name interpolation and plurals. Headless checks cover
the real language selector, persistence, system changes, blocked writes, reactive
invitation dialogs, Chinese settings search anchors, nickname/composer IME
keyboard events, and 1000px/390px layouts. Simulated composition events are not an
OS-native IME acceptance test. A successful build is not real-call acceptance.

The original `pnpm-lock.yaml` is left unchanged as an upstream artifact. Use
`yarn.lock` for this change. The delivery manifest and test logs beside the Web
archive record the exact source hashes, tool versions and remaining failures.
