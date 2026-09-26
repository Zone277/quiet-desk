// Fixed-action, x64 .NET Framework helper. No Explorer injection or elevation.
// WorkerW topology and message 0x052C are undocumented Shell implementation details.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class DesktopHost
{
    const int STYLE = -16, EXSTYLE = -20;
    const long CHILD = 0x40000000L, POPUP = 0x80000000L, CAPTION = 0x00C00000L;
    const long TOOLWINDOW = 0x80L, APPWINDOW = 0x40000L;
    const uint FRAME = 0x20, NOACTIVATE = 0x10, NOZORDER = 4;
    const string OriginalStyle = "QuietDesk.Desktop.OriginalStyle";
    const string OriginalExStyle = "QuietDesk.Desktop.OriginalExStyle";
    const string Owned = "QuietDesk.Desktop.Owned";
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    delegate bool EnumCallback(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetParent(IntPtr hwnd, IntPtr parent);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] static extern IntPtr SetWindowLong(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError = true)] static extern int MapWindowPoints(IntPtr from, IntPtr to, ref Point point, uint count);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] static extern bool AreDpiAwarenessContextsEqual(IntPtr a, IntPtr b);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetProp(IntPtr hwnd, string key, IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetProp(IntPtr hwnd, string key);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr hwnd, string key);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint error);

    static string Class(IntPtr hwnd) { var text = new StringBuilder(256); GetClassName(hwnd, text, text.Capacity); return text.ToString(); }
    static string Hex(IntPtr value) { return "0x" + unchecked((ulong)value.ToInt64()).ToString("X"); }
    static long Style(IntPtr target, int index) { return GetWindowLong(target, index).ToInt64() & 0xFFFFFFFFL; }
    static bool Host(IntPtr hwnd) { return IsWindow(hwnd) && (Class(hwnd) == "WorkerW" || Class(hwnd) == "Progman"); }
    static void Require(bool valid, string message) { if (!valid) throw new InvalidOperationException(message + ": WinError " + Marshal.GetLastWin32Error()); }
    static void WriteStyle(IntPtr target, int index, long style) {
        SetLastError(0); SetWindowLong(target, index, new IntPtr(style));
        Require(Marshal.GetLastWin32Error() == 0 && Style(target, index) == style, "SetWindowLong verification failed");
    }
    static void Parent(IntPtr target, IntPtr parent) {
        SetLastError(0); SetParent(target, parent);
        Require(Marshal.GetLastWin32Error() == 0, "SetParent failed");
        // A WS_CHILD window reparented to NULL temporarily has the desktop parent.
        // Verify NULL only after the caller restores the original top-level style.
        if (parent != IntPtr.Zero) Require(GetParent(target) == parent, "SetParent verification failed");
    }
    static void Position(IntPtr target, IntPtr parent, Rect rect) {
        var point = new Point { X = rect.Left, Y = rect.Top };
        if (parent != IntPtr.Zero) {
            SetLastError(0); MapWindowPoints(IntPtr.Zero, parent, ref point, 1);
            Require(Marshal.GetLastWin32Error() == 0, "MapWindowPoints failed");
        }
        Require(SetWindowPos(target, IntPtr.Zero, point.X, point.Y, rect.Right - rect.Left, rect.Bottom - rect.Top,
            FRAME | NOACTIVATE | NOZORDER), "SetWindowPos failed");
    }
    static IntPtr Discover(out string route) {
        IntPtr progman = FindWindow("Progman", null);
        Require(progman != IntPtr.Zero, "Progman was not found");
        IntPtr result;
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 2, 1000, out result);
        IntPtr host = IntPtr.Zero;
        EnumWindows(delegate(IntPtr top, IntPtr unused) {
            if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) {
                var candidate = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
                if (Host(candidate)) { host = candidate; return false; }
            }
            return true;
        }, IntPtr.Zero);
        route = host != IntPtr.Zero ? "workerw-after-defview" : "progman-fallback";
        return host != IntPtr.Zero ? host : progman;
    }
    static void Forget(IntPtr target) {
        RemoveProp(target, Owned); RemoveProp(target, OriginalStyle); RemoveProp(target, OriginalExStyle);
    }
    static void Detach(IntPtr target) {
        if (GetProp(target, Owned) == IntPtr.Zero) {
            Require(GetParent(target) == IntPtr.Zero, "Refusing to detach an unmanaged parent");
            return;
        }
        Rect rect; Require(GetWindowRect(target, out rect), "GetWindowRect failed");
        Parent(target, IntPtr.Zero);
        WriteStyle(target, STYLE, GetProp(target, OriginalStyle).ToInt64());
        WriteStyle(target, EXSTYLE, GetProp(target, OriginalExStyle).ToInt64());
        Require(GetParent(target) == IntPtr.Zero, "Detach parent verification failed");
        Position(target, IntPtr.Zero, rect);
        Forget(target);
    }
    static string Attach(IntPtr target) {
        string route;
        var host = Discover(out route);
        if (GetParent(target) == host && Host(host)) return route;
        Require(GetParent(target) == IntPtr.Zero || GetProp(target, Owned) != IntPtr.Zero, "Refusing to replace an unmanaged parent");
        Rect rect; Require(GetWindowRect(target, out rect), "GetWindowRect failed");
        if (GetProp(target, Owned) == IntPtr.Zero) {
            Require(SetProp(target, OriginalStyle, new IntPtr(Style(target, STYLE))), "Cannot save original style");
            Require(SetProp(target, OriginalExStyle, new IntPtr(Style(target, EXSTYLE))), "Cannot save original extended style");
            Require(SetProp(target, Owned, new IntPtr(1)), "Cannot mark helper ownership");
        }
        try {
            WriteStyle(target, STYLE, (Style(target, STYLE) | CHILD) & ~(POPUP | CAPTION));
            WriteStyle(target, EXSTYLE, (Style(target, EXSTYLE) | TOOLWINDOW) & ~APPWINDOW);
            Parent(target, host);
            Position(target, host, rect);
            Require(GetParent(target) == host && Host(host), "Desktop parent changed after attach");
        } catch {
            // Preserve the original exception only if the rollback actually succeeded.
            Detach(target);
            throw;
        }
        return route;
    }
    static Dictionary<string, object> Details(IntPtr target, string action, string route) {
        var parent = GetParent(target);
        Rect rect; Require(GetWindowRect(target, out rect), "GetWindowRect failed");
        return new Dictionary<string, object> {
            {"action", action}, {"success", action == "detach" ? parent == IntPtr.Zero : Host(parent)},
            {"route", route}, {"targetHandle", Hex(target)}, {"targetClass", Class(target)},
            {"parentHandle", Hex(parent)}, {"parentClass", Class(parent)},
            {"styleHex", "0x" + Style(target, STYLE).ToString("X")},
            {"exStyleHex", "0x" + Style(target, EXSTYLE).ToString("X")}, {"dpi", GetDpiForWindow(target)},
            {"windowRectPx", new { x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top }}
        };
    }
    static int Main(string[] args) {
        string action = args.Length > 0 ? args[0] : "unknown";
        try {
            if ((args.Length != 2 && args.Length != 3 && !(action == "resize" && args.Length == 5)) ||
                (action != "attach" && action != "inspect" && action != "detach" && action != "resize"))
                return Emit(new { action = action, success = false, error = "Usage: windows_desktop_host.exe attach|inspect|detach <decimal-hwnd> [owner-pid]" }, 2);
            long value;
            if (!long.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out value) || value <= 0)
                return Emit(new { action = action, success = false, error = "HWND must be a positive decimal integer" }, 2);
            var target = new IntPtr(value);
            if (!IsWindow(target)) return Emit(new { action = action, success = false, error = "Target HWND is not a live window" }, 1);
            uint owner;
            GetWindowThreadProcessId(target, out owner);
            uint requestedOwner;
            if (action != "inspect" && (args.Length < 3 || !uint.TryParse(args[2], out requestedOwner) || requestedOwner != owner))
                return Emit(new { action = action, success = false, error = "Mutation requires the target window owner PID" }, 2);
            var dpiContext = new IntPtr(-4);
            Require(SetProcessDpiAwarenessContext(dpiContext) || AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), dpiContext), "Per-monitor V2 DPI awareness unavailable");
            string route = "inspect-" + Class(GetParent(target)).ToLowerInvariant();
            if (action == "attach") route = Attach(target);
            if (action == "detach") { Detach(target); route = "desktop-detach"; }
            if (action == "resize") {
                int dx, dy;
                if (args.Length != 5 || !int.TryParse(args[3], out dx) || !int.TryParse(args[4], out dy) ||
                    Math.Abs((long)dx) > 64 || Math.Abs((long)dy) > 64)
                    return Emit(new { action = action, success = false, error = "Resize requires bounded pixel deltas" }, 2);
                Rect rect; Require(GetWindowRect(target, out rect), "GetWindowRect failed");
                rect.Right += dx; rect.Bottom += dy;
                Position(target, GetParent(target), rect);
                return Emit(new { action = action, success = true }, 0);
            }
            return Emit(Details(target, action, route), 0);
        } catch (Exception error) {
            return Emit(new { action = action, success = false, error = error.Message }, 1);
        }
    }
    static int Emit(object payload, int code) { Console.WriteLine(new JavaScriptSerializer().Serialize(payload)); return code; }
}
