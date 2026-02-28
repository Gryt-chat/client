<div align="center">
  <img src="https://raw.githubusercontent.com/Gryt-chat/client/main/public/logo.svg" width="80" alt="Gryt logo" />
  <h1>Gryt Web Client</h1>
  <p>React web client for the <a href="https://github.com/Gryt-chat/gryt">Gryt</a> voice chat platform.<br />Built with TypeScript, Vite, and Radix UI.</p>
  <p>A hosted version is available at <strong><a href="https://app.gryt.chat">app.gryt.chat</a></strong> — try Gryt without downloading anything.</p>
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

Browse tags at [ghcr.io/gryt-chat/client](https://github.com/Gryt-chat/client/pkgs/container/client).

## Quick Start

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

## Documentation

Full docs at **[docs.gryt.chat/docs/client](https://docs.gryt.chat/docs/client)**:

- [Audio Processing](https://docs.gryt.chat/docs/client/audio-processing) — noise gate, volume control, visualization
- [Voice Communication](https://docs.gryt.chat/docs/client/voice-communication) — WebRTC, SFU connection, mute/deafen
- [User Interface](https://docs.gryt.chat/docs/client/user-interface) — components, theming, responsive design

## Issues

Please report bugs and request features in the [main Gryt repository](https://github.com/Gryt-chat/gryt/issues).

## License

[AGPL-3.0](https://github.com/Gryt-chat/gryt/blob/main/LICENSE) — Part of [Gryt](https://github.com/Gryt-chat/gryt)
