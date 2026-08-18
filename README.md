<div align="center">
  <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="80" alt="Gryt logo" />
  <h1>Gryt Client</h1>
  <p>The Gryt client, for the web and the desktop: one React app, shipped as a browser build and as an Electron app.<br />Built with TypeScript, Vite and <a href="https://github.com/Gryt-chat/ui">@gryt/ui</a>.</p>
  <p>Hosted at <strong><a href="https://app.gryt.chat">app.gryt.chat</a></strong>, or download the desktop app from <a href="https://github.com/Gryt-chat/gryt/releases/latest">Releases</a>.</p>
</div>

<br />

## Docker

```bash
docker pull ghcr.io/gryt-chat/client:latest
docker run -p 80:80 ghcr.io/gryt-chat/client:latest
```

The entrypoint injects runtime configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GRYT_OIDC_ISSUER` | `https://auth.gryt.chat/realms/gryt` | OIDC issuer URL |
| `GRYT_OIDC_REALM` | `gryt` | Keycloak realm |
| `GRYT_OIDC_CLIENT_ID` | `gryt-web` | OIDC client ID |
| `GRYT_AUTH_API` | `https://auth.gryt.chat` | Auth API base URL |
| `GRYT_AUTH_CALLBACK_URL` | `https://gryt.chat/auth/callback` | OAuth callback URL (used by Electron login) |

Browse tags at [ghcr.io/gryt-chat/client](https://github.com/Gryt-chat/client/pkgs/container/client).

## Quick start

```bash
yarn install
yarn dev
```

Open **http://localhost:3666**.

## Build

```bash
yarn build
yarn preview
```

## Desktop

The same source builds the Electron app. `electron/` holds the main process,
which is where the tray, auto-updates, global shortcuts, native screen and audio
capture, and the embedded server live. `electron-builder.yml` configures the
AppImage, deb, snap, Windows and macOS builds.

Releases are cut from the [main Gryt repository](https://github.com/Gryt-chat/gryt/releases/latest),
not from here.

## Documentation

Full docs at **[docs.gryt.chat/docs/client](https://docs.gryt.chat/docs/client)**:

- [Audio Processing](https://docs.gryt.chat/docs/client/audio-processing) — noise gate, volume control, visualization
- [Voice Communication](https://docs.gryt.chat/docs/client/voice-communication) — WebRTC, SFU connection, mute/deafen
- [User Interface](https://docs.gryt.chat/docs/client/user-interface) — components, theming, responsive design

## Issues

Please report bugs and request features in the [main Gryt repository](https://github.com/Gryt-chat/gryt/issues).

## Sponsors

What sponsoring pays for, the tiers, and everyone who has sponsored:
[gryt.chat/sponsors](https://gryt.chat/sponsors). To sponsor:
[GitHub Sponsors](https://github.com/sponsors/Gryt-chat).

The list itself lives in the [Gryt README](https://github.com/Gryt-chat/gryt#sponsors),
in one place rather than ten, so it cannot fall out of step across repositories.

## License

[AGPL-3.0](https://github.com/Gryt-chat/gryt/blob/main/LICENSE) — Part of [Gryt](https://github.com/Gryt-chat/gryt)
