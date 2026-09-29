// Read-only wallpaper configuration fingerprint. No filenames/content are emitted.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal static class WallpaperState
{
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDesktopWallpaper
    {
        void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitor, [MarshalAs(UnmanagedType.LPWStr)] string path);
        [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitor);
        [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint index);
        uint GetMonitorDevicePathCount();
        Rect GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitor);
        void SetBackgroundColor(uint color);
        uint GetBackgroundColor();
        void SetPosition(uint position);
        uint GetPosition();
        void SetSlideshow(IntPtr items);
        IntPtr GetSlideshow();
        void SetSlideshowOptions(uint options, uint interval);
        void GetSlideshowOptions(out uint options, out uint interval);
        void AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string monitor, uint direction);
        uint GetStatus();
    }

    private static void AddRegistry(SortedDictionary<string, string> data,
        SortedDictionary<string, string> active, string path, bool desktopOnly)
    {
        using (var key = Registry.CurrentUser.OpenSubKey(path)) {
            if (key == null) return;
            foreach (var name in key.GetValueNames()) {
                if (desktopOnly && !name.StartsWith("TranscodedImageCache", StringComparison.OrdinalIgnoreCase) &&
                    name != "WallPaper" && name != "Wallpaper" && name != "WallpaperStyle" && name != "TileWallpaper") continue;
                var value = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                var bytes = value as byte[];
                var strings = value as string[];
                var destination = desktopOnly && (name.StartsWith("TranscodedImageCache", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("Wallpaper", StringComparison.OrdinalIgnoreCase)) ? active : data;
                destination[path + "/" + name] = bytes != null ? Convert.ToBase64String(bytes) :
                    strings != null ? String.Join("\n", strings) : Convert.ToString(value);
            }
        }
    }

    [STAThread]
    private static void Main()
    {
        var data = new SortedDictionary<string, string>(StringComparer.Ordinal);
        var active = new SortedDictionary<string, string>(StringComparer.Ordinal);
        AddRegistry(data, active, @"Control Panel\Desktop", true);
        AddRegistry(data, active, @"Control Panel\Personalization\Desktop Slideshow", false);
        AddRegistry(data, active, @"Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers", false);
        var desktop = (IDesktopWallpaper)Activator.CreateInstance(Type.GetTypeFromCLSID(
            new Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")));
        uint count, status, position;
        try {
            count = desktop.GetMonitorDevicePathCount();
            status = desktop.GetStatus();
            position = desktop.GetPosition();
            data["status"] = status.ToString();
            data["position"] = position.ToString();
            data["color"] = desktop.GetBackgroundColor().ToString();
            uint options, interval;
            desktop.GetSlideshowOptions(out options, out interval);
            data["slideshowOptions"] = options.ToString();
            data["slideshowInterval"] = interval.ToString();
            for (uint i = 0; i < count; i++) {
                var monitor = desktop.GetMonitorDevicePathAt(i);
                active["monitor/" + monitor] = desktop.GetWallpaper(monitor);
            }
        } finally { Marshal.FinalReleaseComObject(desktop); }
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            configurationSha256 = Hash(data), activeWallpaperSha256 = Hash(active),
            monitorCount = count, slideshowStatus = status, position
        }));
    }

    private static string Hash(object data)
    {
        var json = new JavaScriptSerializer().Serialize(data);
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(json))).Replace("-", "");
    }
}
