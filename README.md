# Google Docs Voice Notes

A Google Docs add-on (Apps Script) that records a voice note in a sidebar and
saves it to the same Drive folder as the open document.

## Stages (one Git branch each)
1. `feature/recorder-sidebar` - record, stop, play back
2. `feature/save-to-drive` - save audio next to the current Doc
3. `feature/insert-link` - insert the audio link into the Doc
4. `feature/native-comments` - real Docs comments (Developer Preview)

## Chrome extension (current approach)
Apps Script can't use the microphone (sidebars and dialogs are blocked), so the
recorder is a Chrome extension in `extension/`. No server: audio goes straight
from the browser to Google Drive, into the same folder as the open Doc.

### Setup (Chrome or Edge)
1. Open `chrome://extensions` (or `edge://extensions`) -> Developer mode -> Load unpacked -> pick `extension/`.
2. The extension has a fixed ID (set by the `key` in `manifest.json`): `lbfgidfakfnckejmjgidjimgkblcbgkl`.
   Its redirect address is `https://lbfgidfakfnckejmjgidjimgkblcbgkl.chromiumapp.org/`.
3. Google Cloud Console: new project -> enable Google Drive API -> OAuth consent screen
   (External, add yourself as a test user) -> Credentials -> OAuth client ID -> type **Web application**,
   add the redirect address from step 2 under "Authorized redirect URIs".
4. Put the client ID in `extension/background.js` (`CLIENT_ID`), then reload the extension.
