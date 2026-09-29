// Stage 8A: read-only, on-demand Win32 diagnostics. No input injection or Shell mutation.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

internal static class Stage8DesktopDiagnostic
{
    private const int UoiName = 2;
    private const uint DesktopReadObjects = 0x0001;
    private const uint GwOwner = 4;
    private const uint GwHwndPrev = 3;
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;

    private delegate bool EnumWindowsCallback(IntPtr hwnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetUserObjectInformation(IntPtr handle, int index, System.Text.StringBuilder name, int length, out int needed);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder name, int length);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    private static string Hex(IntPtr value) { return "0x" + value.ToInt64().ToString("X"); }

    private static string ObjectName(IntPtr handle)
    {
        if (handle == IntPtr.Zero) return null;
        var buffer = new System.Text.StringBuilder(256);
        int needed;
        return GetUserObjectInformation(handle, UoiName, buffer, buffer.Capacity * 2, out needed)
            ? buffer.ToString() : "<unavailable:" + Marshal.GetLastWin32Error() + ">";
    }

    private static string DesktopOf(uint threadId)
    {
        var handle = GetThreadDesktop(threadId);
        return handle == IntPtr.Zero
            ? "<unavailable:" + Marshal.GetLastWin32Error() + ">" : ObjectName(handle);
    }

    private static object ProcessInfo(Process process)
    {
        var desktopNames = new HashSet<string>();
        try
        {
            foreach (ProcessThread thread in process.Threads) desktopNames.Add(DesktopOf((uint)thread.Id));
        }
        catch (Exception ex) { desktopNames.Add("<threads-unavailable:" + ex.GetType().Name + ">"); }
        var mainWindow = process.MainWindowHandle;
        uint mainPid;
        var mainThreadId = GetWindowThreadProcessId(mainWindow, out mainPid);
        return new { pid = process.Id, sessionId = process.SessionId, desktops = desktopNames,
            mainWindowHwnd = Hex(mainWindow),
            mainWindowDesktop = mainThreadId == 0 ? null : DesktopOf(mainThreadId) };
    }

    private static string ClassOf(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return null;
        var name = new System.Text.StringBuilder(128);
        return GetClassName(hwnd, name, name.Capacity) > 0 ? name.ToString() : null;
    }

    private static object WindowInfo(IntPtr hwnd)
    {
        uint pid;
        uint threadId = GetWindowThreadProcessId(hwnd, out pid);
        var parent = GetParent(hwnd);
        uint parentPid;
        uint parentThreadId = GetWindowThreadProcessId(parent, out parentPid);
        int? parentSessionId = null;
        try { if (parentPid != 0) parentSessionId = Process.GetProcessById((int)parentPid).SessionId; }
        catch { /* Parent may exit during this point-in-time observation. */ }
        var owner = GetWindow(hwnd, GwOwner);
        var previous = GetWindow(hwnd, GwHwndPrev);
        var parentPrevious = GetWindow(parent, GwHwndPrev);
        Rect rect;
        bool hasRect = GetWindowRect(hwnd, out rect);
        return new {
            hwnd = Hex(hwnd), pid, threadId, desktop = DesktopOf(threadId),
            className = ClassOf(hwnd), parent = Hex(parent), parentClass = ClassOf(parent),
            parentPid, parentSessionId, parentDesktop = parentThreadId == 0 ? null : DesktopOf(parentThreadId),
            parentVisible = parent != IntPtr.Zero && IsWindowVisible(parent),
            parentPreviousTopLevel = Hex(parentPrevious), parentPreviousClass = ClassOf(parentPrevious),
            owner = Hex(owner), ownerClass = ClassOf(owner), previousSibling = Hex(previous),
            previousSiblingClass = ClassOf(previous), visible = IsWindowVisible(hwnd),
            style = Hex(GetWindowLongPtr(hwnd, GwlStyle)), exStyle = Hex(GetWindowLongPtr(hwnd, GwlExStyle)),
            dpi = GetDpiForWindow(hwnd),
            bounds = hasRect ? new { left = rect.Left, top = rect.Top, right = rect.Right, bottom = rect.Bottom } : null
        };
    }

    private static void Main()
    {
        var self = Process.GetCurrentProcess();
        var input = OpenInputDesktop(0, false, DesktopReadObjects);
        var inputName = ObjectName(input);
        if (input != IntPtr.Zero) CloseDesktop(input);

        var explorer = new List<object>();
        var codexUi = new List<object>();
        var quietDesk = new List<object>();
        var targetPids = new HashSet<uint>();
        var explorerPids = new HashSet<uint>();
        foreach (var process in Process.GetProcessesByName("explorer")) {
            explorer.Add(ProcessInfo(process));
            explorerPids.Add((uint)process.Id);
        }
        foreach (var process in Process.GetProcessesByName("ChatGPT")) codexUi.Add(ProcessInfo(process));
        foreach (var process in Process.GetProcessesByName("codex")) codexUi.Add(ProcessInfo(process));
        foreach (var process in Process.GetProcessesByName("QuietDesk"))
        {
            quietDesk.Add(ProcessInfo(process));
            targetPids.Add((uint)process.Id);
        }

        var windows = new List<object>();
        var shellWindows = new List<object>();
        var seen = new HashSet<IntPtr>();
        EnumWindowsCallback collect = delegate(IntPtr hwnd, IntPtr ignored) {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (targetPids.Contains(pid) && seen.Add(hwnd)) windows.Add(WindowInfo(hwnd));
            if (explorerPids.Contains(pid)) {
                var cls = ClassOf(hwnd);
                if (cls == "WorkerW" || cls == "Progman" || cls == "SHELLDLL_DefView")
                    shellWindows.Add(WindowInfo(hwnd));
            }
            return true;
        };
        EnumWindows(delegate(IntPtr root, IntPtr ignored) {
            collect(root, IntPtr.Zero);
            EnumChildWindows(root, collect, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);

        var foreground = GetForegroundWindow();
        uint foregroundPid;
        GetWindowThreadProcessId(foreground, out foregroundPid);
        var result = new {
            capturedAtUtc = DateTime.UtcNow.ToString("o"),
            machine = new { compatibilityReportedOsVersion = Environment.OSVersion.VersionString,
                os64Bit = Environment.Is64BitOperatingSystem },
            observer = new { pid = self.Id, sessionId = self.SessionId,
                windowStation = ObjectName(GetProcessWindowStation()),
                desktop = DesktopOf(GetCurrentThreadId()), inputDesktop = inputName },
            explorer, codexUi, quietDesk, quietDeskWindows = windows, shellWindows,
            foreground = new { hwnd = Hex(foreground), pid = foregroundPid,
                isQuietDesk = targetPids.Contains(foregroundPid) }
        };
        // Deliberately omit window titles, UI text, keystrokes, and unrelated process names.
        Console.WriteLine(new JavaScriptSerializer().Serialize(result));
    }
}
