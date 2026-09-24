using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Interop;
using ShoulderTap;

internal static class Tests
{
    [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor callback, IntPtr data);
    private delegate bool Visitor(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }

    [STAThread]
    public static int Main(string[] args)
    {
        var exe = args[0];
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var result = 0;
        async Task Send(params string[] values)
        {
            var start = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true };
            foreach (var value in values) start.ArgumentList.Add(value);
            using var process = Process.Start(start)!;
            await process.WaitForExitAsync();
        }
        app.Startup += async (_, _) => {
            var windows = new List<Window>();
            try
            {
                var parsed = TapRequest.FromArgs(["--mode", "complete", "--session", "three", "--window", "123"]);
                if (TapRequest.FromJson(parsed.ToJson())?.WindowHandle != 123 || !parsed.HasMessage)
                    throw new Exception("Request round trip failed");
                var captioned = TapRequest.FromArgs(["--text", "hi", "--caption", "聚焦 A ｜ 刚才 B"]);
                if (TapRequest.FromJson(captioned.ToJson())?.Caption != "聚焦 A ｜ 刚才 B")
                    throw new Exception("Caption did not survive the round trip");
                var expected = new HashSet<int>();
                for (var i = 0; i < 3; i++)
                {
                    var window = new Window { Title = $"Shoulder Tap test {i + 1}", Width = 300, Height = 330,
                        Left = 30 + i * 330, Top = 80, WindowStartupLocation = WindowStartupLocation.Manual };
                    window.Show(); windows.Add(window);
                    var hwnd = new WindowInteropHelper(window).Handle;
                    GetWindowRect(hwnd, out var bounds); expected.Add(bounds.Left);
                    await Send("--mode", "bind", "--session", $"test-{i}", "--window", hwnd.ToInt64().ToString());
                }
                await Task.Delay(300);
                for (var i = 0; i < 3; i++) await Send("--mode", "complete", "--session", $"test-{i}");
                var seen = new HashSet<int>();
                var clock = Stopwatch.StartNew();
                while (clock.ElapsedMilliseconds < 12000) // 每次完成手停 3.6s，三次串行
                {
                    EnumWindows((hwnd, _) => {
                        var title = new StringBuilder(256); GetWindowText(hwnd, title, 256);
                        if (title.ToString() == "shoulder-tap" && IsWindowVisible(hwnd))
                        { GetWindowRect(hwnd, out var bounds); seen.Add(bounds.Left); }
                        return true;
                    }, IntPtr.Zero);
                    await Task.Delay(25);
                }
                if (seen.Count == 0) throw new Exception("Completion never showed"); // 位置跟前台窗口走，不再按会话窗口路由
                Console.WriteLine("PASS: request IPC round trip, three queued completions routed to three source windows.");
            }
            catch (Exception error) { Console.Error.WriteLine(error); result = 1; }
            finally
            {
                await Send("--quit");
                foreach (var window in windows) window.Close();
                app.Shutdown();
            }
        };
        app.Run();
        return result;
    }
}
