# AppImageHub Listing

## How to submit

1. Fork [AppImage/appimage.github.io](https://github.com/AppImage/appimage.github.io).
2. Copy the `Gryt_Chat` file into the `data/` directory.
3. Open a PR.

The `Gryt_Chat` file contains a single line: the GitHub repo URL. AppImageHub's CI automatically scrapes the latest release for `.AppImage` files and extracts metadata from them.

No YAML or metadata needed -- it's all pulled from the AppImage itself.
