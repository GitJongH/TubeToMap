# TubeToMap

[한국어](README.md)

A Chrome extension that saves the **Google Maps links in a YouTube video's description** to one of **your Google Maps lists** in one go. Instead of opening and saving each place from a food or travel video by hand, you do it with one click.

- Finds the map links in the description and shows each place with its name; you choose which ones to save.
- Saves to an existing Google Maps list of yours, or to a new list you create.
- Writes the **video title and URL into each place's note** so you remember why you saved it.
- Retries only the failed places, and opens the list in Google Maps so you can check the result.

> **Note** Google Maps has no official API for lists, so TubeToMap automates the Google Maps pages in your own logged-in browser. It is an unofficial tool and is not affiliated with Google or YouTube.

## Install

1. Download this repository (Code → Download ZIP and unzip, or `git clone`).
2. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Make sure you are signed in to Google Maps in the same Chrome.

Requirements: Chrome 114+ (side panel support); Google Maps display language **Korean or English**.

## Use

1. On a YouTube video page, click the TubeToMap icon to open the **side panel**. It re-reads when you switch to another video.
2. The first time, it loads your Google Maps lists automatically. Pick a **list**, or type a **new list name** and press the create button.
   - The ↗ icon at the right of each place opens it in Google Maps so you can see what it is.
3. Check the places you want and press **Save N places**. While saving, the time left is shown, and **Stop** finishes the current place and stops. After stopping, **Continue with N left** resumes.
4. Each place's note gets `YouTube: <video title> <video url>`. If a note already exists the line is appended; places already in the list are marked "already there" and only get the note.
5. When it finishes, open the result in Google Maps from the panel. Failed places can be retried on their own.

While saving, a Google Maps window opens briefly and Chrome shows a "debugging" banner. That is expected (see Privacy).

## Privacy and permissions

- It sends **no data to any server** run by the developer or third parties and has no analytics. See [PRIVACY.md](PRIVACY.md) (Korean, with an English summary at the bottom).
- The `debugger` permission is used only to emulate page focus (`Emulation.setFocusEmulationEnabled`) so text input and note saving work while the work window is in the background. This is why the "debugging" banner appears.

### Warnings shown at install

Chrome shows permission warnings when you install an extension. TubeToMap triggers the ones below; here is why and what it actually does.

| Warning shown by Chrome | Why |
|---|---|
| **Access the page debugger backend**<br>**Read and change all your data on all websites** (`debugger` permission) | Needed so text input and note saving work even when the Google Maps work window does not have focus. See below. |
| Read your browsing history (`tabs` permission) | Needed to check whether the current tab is a YouTube video and whether the work window is open. It only reads tab addresses; it does not store or send browsing history. |
| Read and change your data on youtube.com / google.com | Needed to read the video description, and to read your lists and save places on Google Maps pages. |

**The `debugger` permission does one thing.** While saving, it attaches to **the single tab of the Google Maps work window** and sends one command, `Emulation.setFocusEmulationEnabled`, which makes the page believe it has focus. It does not read page content or touch other tabs. When the job ends it detaches and closes the window. You can verify this in `emulateFocus` and `closeWork` in `background.js`. The "debugging" banner Chrome shows during a job comes from this attachment.

If this bothers you, you do not have to install it. The whole source is public so you can read it and decide.

## Known limitations

- Only the Google Maps **Korean and English** UIs are supported (English verified with `?hl=en`). Add other languages to the text table in `lib/ui.js`.
- The extension's own interface is available in **Korean and English** and follows your browser language (anything else falls back to English). To add a language, copy `_locales/en/messages.json` and translate it (`npm test` reports missing keys).
- Only `google.com` / `google.co.kr` map domains, and only the default signed-in account.
- A newly created list can take a few seconds to appear in a place's save dialog; the extension retries once automatically.
- Google may change its pages and break the automation. See "Reporting problems".
- Saving many places takes time (1.5 s between places). It is designed for personal, small-scale use.

## Reporting problems

If the panel shows that **Google Maps seems to have changed**, press the copy-diagnostics button and paste the text into a [new issue](../../issues/new/choose). The diagnostics contain only an error code, the page language, the version and browser info — no personal data. Requests for new Google Maps display languages are welcome as issues too.

## Development

Plain JavaScript with no dependencies and no build step. After editing, press the reload (↻) button for the extension on `chrome://extensions`.

```
manifest.json      Extension manifest (Manifest V3)
background.js      Service worker: opens a work window, processes places one by one, records progress
content/maps.js    Google Maps page automation (read lists, create list, save place, note)
lib/ui.js          Google Maps UI strings (ko/en) and matchers — start here when Google changes its pages
lib/parse.js       Extracts place names and map links from a description
lib/eta.js         Estimates the time left for a saving job
_locales/          The extension's own UI strings (en, ko)
popup/             Side panel UI (the folder is still named popup)
icons/             Icons
test/              Unit tests
```

```
npm test        # or: node --test test/parse.test.js test/ui.test.js test/eta.test.js test/i18n.test.js
```

Node 18+. Tests cover description parsing, Google Maps UI-string matching and translation consistency (matching keys across languages, a translation for every error code); the Google Maps automation itself has to be checked against the real pages.

## License

[MIT](LICENSE)
