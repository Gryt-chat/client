{
  "targets": [
    {
      "target_name": "gryt_keychain",
      "sources": ["keychain.mm"],
      "xcode_settings": {
        "MACOSX_DEPLOYMENT_TARGET": "12.0",
        "OTHER_CFLAGS": ["-fobjc-arc"]
      },
      "link_settings": { "libraries": ["-framework Security", "-framework Foundation"] }
    }
  ]
}
