// One-shot diagnostic only. Signals Explorer to reconsider the existing
// wallpaper without setting a wallpaper, restarting Explorer, or injecting code.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class Stage8WallpaperNotify
{
    private const uint WmSettingChange = 0x001A;
    private const uint SpiSetDeskWallpaper = 0x0014;
    private const uint SmtoAbortIfHung = 0x0002;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder className, int capacity);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam,
        IntPtr lParam, uint flags, uint timeoutMs, out IntPtr result);

    private static int Main(string[] args)
    {
        if (args.Length != 1 || args[0] != "--notify-wallpaper") {
            Console.Error.WriteLine("Explicit --notify-wallpaper argument required.");
            return 2;
        }
        var progman = FindWindow("Progman", null);
        uint ownerPid;
        if (progman == IntPtr.Zero || GetWindowThreadProcessId(progman, out ownerPid) == 0) {
            Console.Error.WriteLine("Progman not available.");
            return 1;
        }
        var className = new StringBuilder(64);
        GetClassName(progman, className, className.Capacity);
        Process owner;
        try { owner = Process.GetProcessById((int)ownerPid); }
        catch { Console.Error.WriteLine("Progman owner exited."); return 1; }
        if (className.ToString() != "Progman" ||
            !owner.ProcessName.Equals("explorer", StringComparison.OrdinalIgnoreCase) ||
            owner.SessionId != Process.GetCurrentProcess().SessionId) {
            Console.Error.WriteLine("Refusing to notify an unverified desktop host.");
            return 1;
        }
        IntPtr response;
        var sent = SendMessageTimeout(progman, WmSettingChange, new IntPtr(SpiSetDeskWallpaper),
            IntPtr.Zero, SmtoAbortIfHung, 1500, out response);
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            action = "notify-wallpaper", targetClass = "Progman", ownerPid,
            sessionId = owner.SessionId, sent = sent != IntPtr.Zero,
            winError = sent == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0,
            wallpaperSettingsWritten = false
        }));
        return sent == IntPtr.Zero ? 1 : 0;
    }
}
