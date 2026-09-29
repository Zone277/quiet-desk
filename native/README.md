# Windows desktop helper

Build on Windows x64 with `powershell -NoProfile -File native/build-helper.ps1`.
This invokes the existing `%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe`;
it downloads nothing and installs nothing. Output is `native/bin/windows_desktop_host.exe`.
The generated directory is ignored by `native/.gitignore`.

Runtime requires Windows x64 with .NET Framework 4.x (tested on Windows 11 build
22631 with the installed Framework 4.x). This is a managed executable calling
User32/Kernel32 via P/Invoke, not a standalone C++ executable. It depends on
`System.Web.Extensions` for structured JSON; neither Python nor PowerShell is
required to run the packaged bridge. If Framework/compiler is unavailable, the
build fails explicitly. No automatic installation or global PATH lookup occurs.

Lead build wiring:

- `build:native`: `powershell -NoProfile -File native/build-helper.ps1`
- `prebuild`: `npm run build:native`
- electron-builder `extraResources`: `{ "from": "native/bin", "to": "native", "filter": ["windows_desktop_host.exe"] }`
- Remove the old Python bridge from packaged resources. Python source remains a
  historical spike reference only; the adapter never invokes it.

Development resolves the exe from the application's `native/bin` directory;
packaged execution resolves only `resources/native/windows_desktop_host.exe`.
The main process spawns this fixed executable without a shell, with a five-second
timeout and bounded output. Mutations require a matching target-window PID.
Actions are attach, inspect, detach and a pixel-size correction limited to ±64px
per axis. No SQL, file write, arbitrary command or renderer API is added.

The helper sets Per-Monitor V2 DPI awareness before HWND APIs. Attachment saves
original styles on HWND properties, sets WS_CHILD / clears WS_POPUP and WS_CAPTION,
sets WS_EX_TOOLWINDOW / clears WS_EX_APPWINDOW, and retains WS_THICKFRAME.
It maps screen coordinates into the parent's client space with MapWindowPoints,
then uses SetWindowPos with SWP_NOACTIVATE / SWP_NOZORDER. Rollback and detach
restore original styles and screen position without activating the window.

Electron's integer-DIP frame calculations can skip an exact size at 150% scaling.
The controller first applies intended DIP bounds and then uses bounded physical
pixel deltas to correct the *measured* bounds; status and persisted state still
report actual Electron bounds, never fabricated desired values. Unresolved
geometry emits QUIETDESK_WINDOW_GEOMETRY_MISMATCH. Edge resizing is retained.

WorkerW discovery and message 0x052C are undocumented Shell behavior. A validated
WorkerW after the icon-hosting window is preferred, with Progman fallback. There
is no Explorer injection, Shell replacement, restart or administrator requirement.
Ten-second health checks, display events, resume and explicit retries all stay
inside DesktopHostAdapter. Quit drains in-flight work, serializes state writes,
removes listeners and detaches; Lead owns close-to-hide and application quit.

On a verified legacy Explorer host, detaching the last child also asks User32 to
reload the configured wallpaper surface (`SPI_SETDESKWALLPAPER`, NULL filename,
`SPIF_SENDCHANGE`, without `SPIF_UPDATEINIFILE`). A plain WorkerW repaint or a
manually sent settings notification did not clear the white rectangles reported
on Windows 11 build 22631. This operation does not supply a replacement image.
The helper skips the reload for the newer NOREDIRECTIONBITMAP Progman topology
and for a host still containing another child; those paths are separately logged
and do not carry the legacy cleanup verification. Detach preserves current
visibility rather than restoring the attach-time WS_VISIBLE bit.
The original host HWND/PID and style properties survive a cleanup failure so
the adapter can retry once; repeated failure remains a shutdown error.

`stage8-native-close.mjs --visible-quit` covers quitting a visible Widget; omit
the flag for close-to-hide then quit, and add `--release` for the unpacked app and
its packaged helper. The test compares read-only wallpaper configuration hashes
(per-monitor COM wallpaper/position/status and relevant registry values) before
and after, alongside real HWND/exit assertions. It still labels desktop pixels
NOT_RUN; this diagnostic is not a substitute for visual confirmation.

Native DPI correction is distinct from desktop-host fallback: forced fallback
may use the helper only for size correction but remains bridge=none / attached=false.
Automated runtime checks do not establish Win+D, coverage by ordinary windows,
taskbar/Alt+Tab exclusion, real mouse resizing, multiple monitors or sleep/Explorer
recovery. Those need separate Windows GUI evidence.
