// Test executable only: links the production parser, creates no HWND and changes
// culture only inside this short-lived process. Never packaged as the host helper.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Web.Script.Serialization;

internal static class DesktopResizeRegression
{
    static int Main() {
        var results = new List<object>();
        bool passed = true;
        CheckCulture((CultureInfo)CultureInfo.CurrentCulture.Clone(), results, ref passed);
        foreach (string name in new[] { "en-US", "zh-CN", "fi-FI" }) {
            var culture = (CultureInfo)new CultureInfo(name, false).Clone();
            CheckCulture(culture, results, ref passed);
            culture.NumberFormat.NegativeSign = "\u2212";
            CheckCulture(culture, results, ref passed);
        }
        Console.WriteLine(new JavaScriptSerializer().Serialize(new { passed = passed, cases = results }));
        return passed ? 0 : 1;
    }
    static void CheckCulture(CultureInfo culture, List<object> results, ref bool passed) {
        Thread.CurrentThread.CurrentCulture = culture;
        foreach (string[] pair in new[] { new[] { "2", "0" }, new[] { "-1", "0" },
            new[] { "0", "-2" }, new[] { "-64", "64" }, new[] { "64", "-64" } }) {
            int dx, dy;
            bool accepted = DesktopHost.TryParseResizeDeltas(new[] { "resize", "123", "456", pair[0], pair[1] }, out dx, out dy);
            bool correct = accepted && dx == int.Parse(pair[0], CultureInfo.InvariantCulture) && dy == int.Parse(pair[1], CultureInfo.InvariantCulture);
            passed &= correct;
            results.Add(new { culture = culture.Name, negativeSign = culture.NumberFormat.NegativeSign,
                positiveSign = culture.NumberFormat.PositiveSign,
                args = pair, expected = true, accepted = accepted, dx = dx, dy = dy, correct = correct });
        }
        foreach (string invalid in new[] { "65", "-65", "2147483648", "-2147483648", "NaN", "Infinity", "1.5", "", "\u22122" }) {
            foreach (bool width in new[] { true, false }) {
                int dx, dy;
                var pair = new[] { width ? invalid : "0", width ? "0" : invalid };
                bool accepted = DesktopHost.TryParseResizeDeltas(new[] { "resize", "123", "456", pair[0], pair[1] }, out dx, out dy);
                passed &= !accepted;
                results.Add(new { culture = culture.Name, negativeSign = culture.NumberFormat.NegativeSign,
                    args = pair, expected = false, accepted = accepted, correct = !accepted });
            }
        }
        foreach (string[] argv in new[] { new[] { "resize", "123", "456", "2" },
            new[] { "resize", "123", "456", "2", "0", "extra" } }) {
            int dx, dy;
            bool accepted = DesktopHost.TryParseResizeDeltas(argv, out dx, out dy);
            passed &= !accepted;
            results.Add(new { culture = culture.Name, argumentCount = argv.Length, expected = false, accepted = accepted, correct = !accepted });
        }
    }
}
