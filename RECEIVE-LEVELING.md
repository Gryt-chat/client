# Receive loudness leveling: early client integration

This draft depends on the [companion voice implementation](https://github.com/Gryt-chat/voice/pull/79). Neither published
`@gryt/voice` 0.6.2 nor 0.6.3 provides these APIs. The dependency is intentionally
unchanged until the implementation merges and an official version is released.
**Do not merge this client draft yet.** Pin that exact official release and run a
fresh `yarn install --frozen-lockfile` before making this ready for review.

The setting is off by default, persisted through the existing user settings store,
and passed through `VoiceConfig.audio.receiveLevelingEnabled`. The settings page
shows the observable `useSpeakers().receiveLevelingState`, its diagnostic code,
and the actual added processing delay. Disabling a previously enabled healthy
graph can retain its lookahead delay; the page does not report zero by assumption.

Roster `streamID` assigns the microphone role; `screenShareAudioStreamID` assigns
the screen role and takes precedence on an ambiguous ID. Streams absent from the
roster remain unknown. Screen and unknown audio receive no automatic boost or
compression. Roles are reapplied when the roster or stream source collection
changes. Every existing remote manual gain path calls `receiveCleanup.setMuted`
before updating the gain, including screen viewing and popout volume controls.

Validation commands after installing a compatible voice implementation:

```sh
yarn typecheck
node scripts/check-receive-leveling.mjs
yarn playwright test --config=e2e/playwright.receive.config.ts
```

The UI harness uses synthetic status transitions and a test-only user ID. It
blocks non-loopback requests and real media. The routing check exercises actual
client helpers; DSP checks belong to the companion voice change. These checks
do not establish real two-way call quality, acoustic behavior, device switching
in a live call, or performance while gaming. This is an early implementation
that still needs cleanup, refinement, and that real-world validation.

Generated with assistance from OpenAI Codex. Human review is required before merge.
