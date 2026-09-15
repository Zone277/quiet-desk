"""Controlled Windows Shell desktop-host spike for QuietDesk.

WorkerW and Progman discovery is undocumented Shell behavior and is deliberately
kept behind this small diagnostic bridge. The helper performs no code injection,
requires no administrator rights, and accepts only an action plus a decimal HWND.
"""

from __future__ import annotations

import ctypes
import json
import os
import sys
from ctypes import wintypes
from typing import Any


GWL_STYLE = -16
GWL_EXSTYLE = -20
GW_HWNDNEXT = 2
SMTO_NORMAL = 0x0000
WM_SPAWN_WORKER = 0x052C
WS_CHILD = 0x40000000
WS_POPUP = 0x80000000
WS_CAPTION = 0x00C00000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_APPWINDOW = 0x00040000
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
SWP_FRAMECHANGED = 0x0020


def emit(payload: dict[str, Any], exit_code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    raise SystemExit(exit_code)


if os.name != "nt":
    emit({"action": sys.argv[1] if len(sys.argv) > 1 else "unknown", "success": False,
          "error": "This bridge can run only on Windows"}, 2)


user32 = ctypes.WinDLL("user32", use_last_error=True)
HWND = wintypes.HWND
LONG_PTR = ctypes.c_ssize_t
ULONG_PTR = wintypes.WPARAM
DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = ctypes.c_void_p(-4)

SetProcessDpiAwarenessContext = user32.SetProcessDpiAwarenessContext
SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
SetProcessDpiAwarenessContext.restype = wintypes.BOOL

# SetParent crosses the Python helper/Explorer/Electron process boundary. Match
# Electron's per-monitor-aware coordinate space before calling any HWND API so
# GetWindowRect/SetWindowPos are not DPI-virtualized by this helper process.
ctypes.set_last_error(0)
DPI_CONTEXT_SET = bool(SetProcessDpiAwarenessContext(
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
))
DPI_CONTEXT_ERROR = ctypes.get_last_error()

FindWindowW = user32.FindWindowW
FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
FindWindowW.restype = HWND

FindWindowExW = user32.FindWindowExW
FindWindowExW.argtypes = [HWND, HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
FindWindowExW.restype = HWND

GetParent = user32.GetParent
GetParent.argtypes = [HWND]
GetParent.restype = HWND

GetWindowRect = user32.GetWindowRect
GetWindowRect.argtypes = [HWND, ctypes.POINTER(wintypes.RECT)]
GetWindowRect.restype = wintypes.BOOL

GetDpiForWindow = user32.GetDpiForWindow
GetDpiForWindow.argtypes = [HWND]
GetDpiForWindow.restype = wintypes.UINT

GetClassNameW = user32.GetClassNameW
GetClassNameW.argtypes = [HWND, wintypes.LPWSTR, ctypes.c_int]
GetClassNameW.restype = ctypes.c_int

IsWindow = user32.IsWindow
IsWindow.argtypes = [HWND]
IsWindow.restype = wintypes.BOOL

SetParent = user32.SetParent
SetParent.argtypes = [HWND, HWND]
SetParent.restype = HWND

GetWindowLongPtrW = getattr(user32, "GetWindowLongPtrW", user32.GetWindowLongW)
GetWindowLongPtrW.argtypes = [HWND, ctypes.c_int]
GetWindowLongPtrW.restype = LONG_PTR

SetWindowLongPtrW = getattr(user32, "SetWindowLongPtrW", user32.SetWindowLongW)
SetWindowLongPtrW.argtypes = [HWND, ctypes.c_int, LONG_PTR]
SetWindowLongPtrW.restype = LONG_PTR

SetWindowPos = user32.SetWindowPos
SetWindowPos.argtypes = [HWND, HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                         ctypes.c_int, wintypes.UINT]
SetWindowPos.restype = wintypes.BOOL

SendMessageTimeoutW = user32.SendMessageTimeoutW
SendMessageTimeoutW.argtypes = [HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
                                wintypes.UINT, wintypes.UINT, ctypes.POINTER(ULONG_PTR)]
SendMessageTimeoutW.restype = wintypes.LPARAM

EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, HWND, wintypes.LPARAM)
EnumWindows = user32.EnumWindows
EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
EnumWindows.restype = wintypes.BOOL


def hwnd_number(hwnd: HWND | int | None) -> int:
    if isinstance(hwnd, int):
        return hwnd
    value = getattr(hwnd, "value", None)
    return int(value or 0)


def hwnd_text(hwnd: HWND | int | None) -> str:
    return f"0x{hwnd_number(hwnd):X}"


def class_name(hwnd: HWND | int | None) -> str:
    if not hwnd_number(hwnd):
        return ""
    buffer = ctypes.create_unicode_buffer(256)
    if GetClassNameW(HWND(hwnd_number(hwnd)), buffer, len(buffer)) == 0:
        return ""
    return buffer.value


def last_error_text(prefix: str) -> str:
    code = ctypes.get_last_error()
    return error_code_text(prefix, code)


def error_code_text(prefix: str, code: int) -> str:
    if code == 0:
        return prefix
    return f"{prefix}: WinError {code} ({ctypes.FormatError(code).strip()})"


def read_window_details(target: HWND, action: str, success: bool, route: str,
                        error: str | None = None) -> dict[str, Any]:
    parent = GetParent(target)
    style = int(GetWindowLongPtrW(target, GWL_STYLE)) & 0xFFFFFFFFFFFFFFFF
    ex_style = int(GetWindowLongPtrW(target, GWL_EXSTYLE)) & 0xFFFFFFFFFFFFFFFF
    rect = wintypes.RECT()
    has_rect = bool(GetWindowRect(target, ctypes.byref(rect)))
    result: dict[str, Any] = {
        "action": action,
        "success": success,
        "route": route,
        "targetHandle": hwnd_text(target),
        "targetClass": class_name(target),
        "parentHandle": hwnd_text(parent),
        "parentClass": class_name(parent),
        "styleHex": f"0x{style:X}",
        "exStyleHex": f"0x{ex_style:X}",
        "dpi": int(GetDpiForWindow(target)),
    }
    if has_rect:
        result["windowRectPx"] = {
            "x": rect.left,
            "y": rect.top,
            "width": rect.right - rect.left,
            "height": rect.bottom - rect.top,
        }
    if error:
        result["error"] = error
    return result


def discover_desktop_host() -> tuple[HWND | None, str, str | None]:
    progman = FindWindowW("Progman", None)
    if not progman:
        return None, "none", "Progman was not found"

    # This message and the resulting WorkerW topology are undocumented. Failure
    # is non-fatal because an existing WorkerW or Progman can still be inspected.
    message_result = ULONG_PTR()
    ctypes.set_last_error(0)
    SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0xD, 0x1, SMTO_NORMAL, 1000,
                        ctypes.byref(message_result))

    candidates: list[tuple[HWND, str]] = []

    @EnumWindowsProc
    def find_worker(top_level: HWND, _parameter: wintypes.LPARAM) -> wintypes.BOOL:
        def_view = FindWindowExW(top_level, HWND(0), "SHELLDLL_DefView", None)
        if def_view:
            worker_after = FindWindowExW(HWND(0), top_level, "WorkerW", None)
            if worker_after:
                candidates.append((worker_after, "workerw-after-defview"))
            if class_name(top_level) == "WorkerW":
                candidates.append((top_level, "workerw-containing-defview"))
        return True

    if not EnumWindows(find_worker, 0):
        return None, "none", last_error_text("EnumWindows failed")

    seen: set[int] = set()
    for candidate, route in candidates:
        number = hwnd_number(candidate)
        if number and number not in seen and IsWindow(candidate) and class_name(candidate) == "WorkerW":
            return candidate, route, None
        seen.add(number)

    if IsWindow(progman) and class_name(progman) == "Progman":
        return progman, "progman-fallback", None
    return None, "none", "No validated WorkerW or Progman host was available"


def attach(target: HWND) -> dict[str, Any]:
    host, route, discovery_error = discover_desktop_host()
    if not host:
        return read_window_details(target, "attach", False, route, discovery_error)

    original_rect = wintypes.RECT()
    if not GetWindowRect(target, ctypes.byref(original_rect)):
        return read_window_details(target, "attach", False, route,
                                   last_error_text("GetWindowRect failed"))

    # Microsoft documents that WS_CHILD/WS_POPUP must be adjusted by the caller;
    # for a non-NULL parent the child style is applied before SetParent.
    original_style = int(GetWindowLongPtrW(target, GWL_STYLE))
    original_ex_style = int(GetWindowLongPtrW(target, GWL_EXSTYLE))
    SetWindowLongPtrW(target, GWL_STYLE,
                      LONG_PTR((original_style | WS_CHILD) & ~(WS_POPUP | WS_CAPTION)))
    SetWindowLongPtrW(target, GWL_EXSTYLE,
                      LONG_PTR((original_ex_style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW))
    SetWindowPos(target, HWND(0), 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER |
                 SWP_NOACTIVATE | SWP_FRAMECHANGED)

    ctypes.set_last_error(0)
    SetParent(target, host)
    set_parent_error = ctypes.get_last_error()
    parent = GetParent(target)
    parent_class = class_name(parent)
    attached = hwnd_number(parent) == hwnd_number(host) and parent_class in {"WorkerW", "Progman"}
    if not attached:
        SetWindowLongPtrW(target, GWL_STYLE, LONG_PTR(original_style))
        SetWindowLongPtrW(target, GWL_EXSTYLE, LONG_PTR(original_ex_style))
        SetWindowPos(target, HWND(0), 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER |
                     SWP_NOACTIVATE | SWP_FRAMECHANGED)
        return read_window_details(target, "attach", False, route,
                                   error_code_text("SetParent verification failed", set_parent_error))

    if not SetWindowPos(
        target,
        HWND(0),
        original_rect.left,
        original_rect.top,
        original_rect.right - original_rect.left,
        original_rect.bottom - original_rect.top,
        SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
    ):
        return read_window_details(target, "attach", False, route,
                                   last_error_text("SetWindowPos frame refresh failed"))

    verified_parent = GetParent(target)
    verified_class = class_name(verified_parent)
    success = hwnd_number(verified_parent) == hwnd_number(host) and verified_class in {"WorkerW", "Progman"}
    return read_window_details(
        target,
        "attach",
        success,
        route,
        None if success else "Desktop parent changed during post-attach verification",
    )


def inspect(target: HWND) -> dict[str, Any]:
    parent = GetParent(target)
    parent_class = class_name(parent)
    success = bool(parent) and parent_class in {"WorkerW", "Progman"}
    return read_window_details(
        target,
        "inspect",
        success,
        f"inspect-{parent_class.lower()}" if parent_class else "inspect-unparented",
        None if success else "Window is not parented to a validated WorkerW or Progman host",
    )


def detach(target: HWND) -> dict[str, Any]:
    ctypes.set_last_error(0)
    SetParent(target, HWND(0))
    style = int(GetWindowLongPtrW(target, GWL_STYLE))
    SetWindowLongPtrW(target, GWL_STYLE, LONG_PTR((style | WS_POPUP) & ~WS_CHILD))
    SetWindowPos(target, HWND(0), 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER |
                 SWP_NOACTIVATE | SWP_FRAMECHANGED)
    success = not bool(GetParent(target))
    return read_window_details(
        target,
        "detach",
        success,
        "desktop-detach",
        None if success else last_error_text("SetParent(NULL) verification failed"),
    )


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"attach", "inspect", "detach"}:
        emit({"action": sys.argv[1] if len(sys.argv) > 1 else "unknown", "success": False,
              "error": "Usage: windows_desktop_host.py attach|inspect|detach <decimal-hwnd>"}, 2)

    action = sys.argv[1]
    raw_handle = sys.argv[2]
    if not raw_handle.isascii() or not raw_handle.isdecimal():
        emit({"action": action, "success": False,
              "error": "HWND must be a positive decimal integer"}, 2)

    handle_number = int(raw_handle, 10)
    if handle_number <= 0:
        emit({"action": action, "success": False,
              "error": "HWND must be a positive decimal integer"}, 2)

    target = HWND(handle_number)
    if not IsWindow(target):
        emit({"action": action, "success": False, "targetHandle": hwnd_text(target),
              "error": "Target HWND is not a live window"}, 1)

    if action == "attach":
        if not DPI_CONTEXT_SET:
            emit({"action": action, "success": False,
                  "error": error_code_text(
                      "Could not set helper DPI awareness to Per-Monitor V2",
                      DPI_CONTEXT_ERROR,
                  )}, 1)
        emit(attach(target))
    if action == "inspect":
        emit(inspect(target))
    emit(detach(target))


if __name__ == "__main__":
    main()
