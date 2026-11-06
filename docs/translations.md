# Contributing translations

The web client and Electron app use the same bundled JSON catalogs and i18next
instance. Translations work offline; the app does not contact a translation service.

- `src/locales/en.json` is the source catalog.
- `src/locales/pt-BR.json` contains Brazilian Portuguese translations.
- `src/lib/i18n.ts` configures resources, fallback, interpolation and the preference.
- `src/lib/locale.tsx` connects that instance to React.

## Translate an existing message

Find the message in the English catalog, then edit the value at the same key in
your language's JSON. Keep the key unchanged. Use the surrounding group and the
calling component to understand the context. Check the result in the app under
Settings → Appearance → Display → Language, including narrow windows and tooltips.

Use UTF-8, two spaces, and the same order as the English catalog. JSON does not
support comments. Do not copy untranslated English into a target catalog just to
fill a gap: omit the key until translated, so coverage remains useful. Missing or
empty translations fall back to English.

## Add a message

Choose a semantic key based on its meaning and context, such as
`settings.audio.noiseReduction` or `server.merge.title`. Keep that key when English
wording changes. A component or filename rename should not require renaming keys.
Avoid reusing a key for unrelated meanings just because the English text matches.

Add the English value first and any translations you know. Use the existing hook:

```tsx
const { t } = useLocale();
const title = t("settings.audio.noiseReduction");
```

For socket handlers and other non-React code, import the helper from
`src/lib/i18n.ts`. It uses the same preference, including when localStorage fails:

```ts
translateLocaleMessage("server.connection.statusError", undefined, { status });
```

Always translate a complete message. Do not concatenate translated fragments or
pass an already interpolated English string to the translator. For diagnostics
stored asynchronously, use `localeMessage(key, params)` and translate the descriptor
when rendering. This lets an existing result follow a language change.

Shared setting controls accept `titleKey` separately from the stable English
`title` used for search anchors. Keep that source title unchanged when translating:

```tsx
<ToggleSetting {...props} title="Noise reduction" titleKey="settings.audio.noiseReduction" />
```

Pass changing numbers or units through `titleValue`, rather than concatenating them
into the title. This keeps translation keys and search anchors stable.

The runtime also recognizes exact English source values for shared settings labels
and known server messages. This preserves search IDs and existing protocol messages;
new code should use semantic keys. Unknown messages from administrators or users are
returned unchanged. The translator does not guess translations using regular expressions.

## Parameters and plurals

Parameters use double braces in JSON. Preserve their names; you may reorder them.
Use readable names such as `server`, `count` and `status`. They are text, not HTML.
React handles escaping; do not render translations with `dangerouslySetInnerHTML`.

```json
{
  "duration": {
    "minutes_one": "{{count}} minute",
    "minutes_other": "{{count}} minutes"
  }
}
```

Call the base key with a numeric `count`:

```tsx
t("settings.duration.minutes", { count: minutes })
```

i18next chooses the plural category for the language. Languages may require
`_zero`, `_two`, `_few` or `_many` as well as `_one` and `_other`. Follow their grammar;
do not translate an English plural suffix or use forms such as "minute(s)".

## Check your changes

Run `yarn locales:check`. It checks JSON syntax, duplicate properties, string values,
unknown target keys, parameter compatibility and literal translation references and setting `titleKey` attributes in
source code. It reports incomplete catalog coverage without rejecting partial
translations. Use `yarn locales:check --list-missing` to list missing source keys.

Literal references in conditional expressions are checked too. Dynamic references
(such as shared settings labels or keys held in variables) also need manual review.
The coverage report describes the catalog, not all visible text in the application.
For code changes, also run `yarn typecheck` and `yarn lint` as required by the
[Gryt contribution guide](https://docs.gryt.chat/docs/about/contributing).

## Add a language

1. Create `src/locales/<language-tag>.json`, using `en.json` as the reference. A
   partial translation can start with an empty object and add translated groups.
2. Register the JSON import, resource and supported language in `src/lib/i18n.ts`,
   extend `Locale` and the preference validation, and decide the system-language
   mapping. Use BCP 47 tags, such as `pt-BR`.
3. Add the language to the selector in
   `src/packages/settings/src/components/theme/displaySettings.tsx`.
4. Run the checks and review the interface in that language, including numbers,
   dates, plurals, keyboard navigation and accessible labels.

Submit a pull request with the catalog changes and the areas reviewed. Follow Gryt's
contribution and disclosure rules. The nested JSON format and English base catalog
can also be connected to Weblate later; no hosted translation platform is needed to
contribute now.

## Brazilian Portuguese terminology

| English | pt-BR |
| --- | --- |
| Settings | Configurações |
| Server | Servidor |
| Channel | Canal |
| Role | Cargo |
| Direct messages | Mensagens diretas |
| Screen share | Compartilhamento de tela |
| Mute microphone | Silenciar microfone |
| Notifications | Notificações |

Prefer direct, natural phrasing. Keep product names and protocol tokens such as
`@everyone`, `has:`, and server addresses unchanged. Search can accept localized
aliases while preserving its internal English filter values.
