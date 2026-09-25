using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Windows;
using Forms = System.Windows.Forms;
// UseWindowsForms 的隐式 using 会带进另一个 Application，这里钉死是 WPF 那个。
using Application = System.Windows.Application;

namespace ShoulderTap;

/// <summary>
/// 对外只有一条命令：
///
///     shoulder-tap-tap.exe --text "先停一下。你说好要整理 JD。"
///     shoulder-tap-tap.exe --text "..." --caption "聚焦 API 接口 ｜ 刚才 改好了开关"
///     shoulder-tap-tap.exe --quit
///
/// 没开就开起来然后拍；开着就直接拍。调用方不需要判断，也不需要知道它在不在。
///
/// 屏幕上只有那一下，不显示 --text；它落进托盘提示。--caption 是唯一上屏的字：
/// 一小条，贴在手旁边，手敲完停两秒，两个一起淡出。
/// </summary>
public static class Program
{
    /// <summary>常驻进程的暗号。只有被派出去的那个才带它，调用方永远不写。</summary>
    private const string DaemonFlag = "--daemon";

    [STAThread]
    public static int Main(string[] args)
    {
        var request = TapRequest.FromArgs(args);

        var daemon = args.Any(a =>
            a.Trim('-').Equals("daemon", StringComparison.OrdinalIgnoreCase));

        return daemon ? RunDaemon(request) : Dispatch(request);
    }

    /// <summary>
    /// 命令行那一端。**永远立刻返回** —— 调用方可能是一个在等退出码的 shell，
    /// 让它挂在那里等一个常驻进程退出，是把提醒工具变成了卡死工具。
    /// </summary>
    private static int Dispatch(TapRequest request)
    {
        if (request.WindowHandle == 0 && request.Mode == "bind")
        {
            var source = SourceWindow.Resolve(request.SourcePid);
            request.WindowHandle = (source != IntPtr.Zero ? source : SourceWindow.GetForegroundWindow()).ToInt64();
        }
        var probe = new SingleInstance();

        // 有人在跑：把话交过去就走。这就是「后台运行时直接 touch」那条。
        if (!probe.IsOwner)
        {
            probe.Dispose();
            if (SingleInstance.TrySend(request)) return 0;

            // 交不出去说明那个进程还占着互斥量却已经聋了。派个新的出去顶上，
            // 它拿不到互斥量时会自己拍一次再退，提醒不会被吞掉。
            LaunchDaemon(request);
            return 0;
        }

        // 没人在跑，而且只是让它退出 —— 那就没什么好做的。
        probe.Dispose();
        if (request.Quit) return 0;

        // 没人在跑：派一个常驻进程出去替我拍，自己立刻退。
        LaunchDaemon(request);
        return 0;
    }

    /// <summary>
    /// 把自己再启动一遍，带上暗号。
    ///
    /// `UseShellExecute = true` 是关键：走 ShellExecute 起来的进程不继承父进程的句柄，
    /// 于是调用方的 shell 不会因为管道还开着而傻等。
    /// </summary>
    private static void LaunchDaemon(TapRequest request)
    {
        var exe = Environment.ProcessPath;
        if (exe is null) return;

        var start = new System.Diagnostics.ProcessStartInfo(exe) { UseShellExecute = true };
        start.ArgumentList.Add(DaemonFlag);
        start.ArgumentList.Add("--mode"); start.ArgumentList.Add(request.Mode);
        start.ArgumentList.Add("--session"); start.ArgumentList.Add(request.Session);
        start.ArgumentList.Add("--window"); start.ArgumentList.Add(request.WindowHandle.ToString());
        start.ArgumentList.Add("--source-pid"); start.ArgumentList.Add(request.SourcePid.ToString());

        if (request.HasMessage)
        {
            start.ArgumentList.Add("--text");
            start.ArgumentList.Add(request.Text);
        }
        if (request.Caption.Length > 0)
        {
            start.ArgumentList.Add("--caption");
            start.ArgumentList.Add(request.Caption);
        }
        if (request.Habit.Length > 0)
        {
            start.ArgumentList.Add("--habit"); start.ArgumentList.Add(request.Habit);
            start.ArgumentList.Add("--node"); start.ArgumentList.Add(request.Node);
        }

        try { System.Diagnostics.Process.Start(start); } catch { }
    }

    /// <summary>常驻的那一端。拿到互斥量就守着，拿不到说明刚才有人抢先了。</summary>
    private static int RunDaemon(TapRequest request)
    {
        var instance = new SingleInstance();

        if (!instance.IsOwner)
        {
            // 两个 Dispatch 几乎同时发现没人在跑，各派了一个出来。输的这个别把话弄丢：
            // 先试着交给赢的那个，交不出去就自己拍一次，拍完退场。
            instance.Dispose();
            return SingleInstance.TrySend(request) ? 0 : Run(request, instance: null);
        }

        using (instance) return Run(request, instance);
    }

    /// <summary>一条道：一扇窗、一个队列。两条道各播各的，taptap 和拍拍可以同时在屏上。</summary>
    private sealed class Lane
    {
        public readonly TapWindow Window;
        public readonly Queue<TapRequest> Queue = new();
        public bool Playing;
        public Lane(bool lower) => Window = new TapWindow(lower);
    }

    private static int Run(TapRequest first, SingleInstance? instance)
    {
        var resident = instance is not null;

        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var taps = new Lane(lower: false);   // taptap：提醒，挂在屏幕 30% 高
        var pats = new Lane(lower: true);    // 响指（这轮做完了）/ 拍拍（在问你话）：挂在 52% 高
        Forms.NotifyIcon? tray = null;
        var bindings = new Dictionary<string, (IntPtr Handle, uint Pid)>();
        void Next(Lane lane)
        {
            if (lane.Playing || lane.Queue.Count == 0) return;
            var req = lane.Queue.Dequeue();
            if (req.Mode != "complete")
            {
                Remember(tray, req.Text);
                lane.Playing = true;
                lane.Window.Tap(snap: req.Mode == "snap", caption: req.Caption, habit: req.Habit, node: req.Node);
                return;
            }
            var anchor = new IntPtr(req.WindowHandle);
            if (anchor == IntPtr.Zero && bindings.TryGetValue(req.Session, out var binding))
            {
                SourceWindow.GetWindowThreadProcessId(binding.Handle, out var pid);
                if (pid == binding.Pid) anchor = binding.Handle;
            }
            if (!SourceWindow.IsWindow(anchor)) anchor = SourceWindow.Resolve(req.SourcePid);
            // 找不到会话窗口也照拍：位置跟前台窗口走，不再依赖它。
            lane.Playing = true;
            lane.Window.Tap(anchor, complete: true, caption: req.Caption);
        }
        void Handle(TapRequest req)
        {
            Log("handle " + req.ToJson());
            if (req.Quit) { app.Shutdown(); return; }
            if (req.Mode == "today") { OpenSettings(); return; } // 今天、习惯、手、设置都在那一页里
            if (req.Mode == "bind")
            {
                var hwnd = new IntPtr(req.WindowHandle);
                if (req.Session.Length > 0 && SourceWindow.IsWindow(hwnd))
                {
                    SourceWindow.GetWindowThreadProcessId(hwnd, out var pid);
                    bindings[req.Session] = (hwnd, pid);
                }
                return;
            }
            if (req.Mode != "complete" && !req.HasMessage) return;
            var lane = req.Mode == "tap" ? taps : pats; // taptap 自己一条道，跟另外两只能同时在屏上
            lane.Queue.Enqueue(req);
            Next(lane);
        }
        foreach (var lane in new[] { taps, pats })
        {
            var self = lane;
            self.Window.Dismissed += () => { self.Playing = false; Next(self); };
            // 一次性模式：卡片收起来就走人。
            if (!resident) self.Window.Dismissed += () => self.Window.Dispatcher.BeginInvoke(() => app.Shutdown());
        }

        if (resident)
        {
            tray = BuildTray(taps.Window, app, () => Handle(new TapRequest { Text = "试拍" }));
            if (!Onboarded()) OpenSettings("--setup"); // 第一次打开：直接进引导；之后点图标都是首页
            instance!.Listen(req => taps.Window.Dispatcher.BeginInvoke(() => Handle(req)));
        }

        app.Startup += (_, _) =>
        {
            if (first.HasMessage || first.Mode == "bind") Handle(first);
            else if (!resident) app.Shutdown(); // 没话说又不常驻，没事干
        };

        var code = app.Run();

        if (tray is not null) { tray.Visible = false; tray.Dispose(); }
        taps.Window.Close();
        pats.Window.Close();
        return code;
    }

    /// <summary>出了问题时唯一能看的地方：%TEMP%\shoulder-tap-tap.log，每次拍一行。</summary>
    public static void Log(string line)
    {
        try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "shoulder-tap-tap.log"), $"{DateTime.Now:HH:mm:ss.fff} {line}\n"); } catch { }
    }

    /// <summary>
    /// 托盘图标是这个进程唯一「看得见自己还活着」的地方，也是唯一能关掉它的地方。
    /// 没有它，一个无窗口、不进任务栏的常驻进程只能靠任务管理器杀，太粗暴。
    /// </summary>
    private static Forms.NotifyIcon BuildTray(TapWindow window, Application app, Action testTap)
    {
        // 今天、习惯、手、设置都是浏览器里的那一页（onboard.mjs），三个平台共用。
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("打开 shoulder-tap", null, (_, _) => OpenSettings());
        menu.Items.Add("拍一下试试", null, (_, _) => window.Dispatcher.BeginInvoke(testTap));

        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("退出", null, (_, _) => window.Dispatcher.BeginInvoke(() => app.Shutdown()));

        var tray = new Forms.NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Text = "shoulder-tap · 在跑",
            Visible = true,
            ContextMenuStrip = menu,
        };

        tray.MouseClick += (_, e) => { if (e.Button == Forms.MouseButtons.Left) OpenSettings(); };
        return tray;
    }

    private static readonly string Home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    /// <summary>设置页走完会在 config.json 里写 onboarded: true。</summary>
    private static bool Onboarded()
    {
        try { return File.ReadAllText(Path.Combine(Home, ".claude", "shoulder-tap", "config.json")).Contains("\"onboarded\": true"); }
        catch { return false; }
    }

    /// <summary>
    /// 设置页是 skill 里的 onboard.mjs：本机起一个小服务，浏览器打开，设完自己退出。
    /// 已经开着一个时它自己会把浏览器指过去，这里不用管。
    /// </summary>
    public static void OpenSettings(string? arg = null)
    {
        var script = Path.Combine(Home, ".claude", "skills", "shoulder-tap", "onboard.mjs");
        if (!File.Exists(script))
        {
            // skill 被删了或只装了桌面端：说出来，别只写日志。
            System.Windows.MessageBox.Show($"{script} 不在。回仓库跑一次 node install.mjs。", "找不到设置页");
            return;
        }
        try
        {
            var start = new System.Diagnostics.ProcessStartInfo("node") { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add(script);
            if (arg is not null) start.ArgumentList.Add(arg);
            System.Diagnostics.Process.Start(start);
        }
        catch (Exception e) { Log("open settings: " + e.Message); }
    }

    /// <summary>
    /// 把最后一次拍肩的内容记在托盘提示上。屏幕上不显示文字，但你回头想看一眼时
    /// 总得有个地方 —— 鼠标悬到托盘图标上就是那个地方。
    /// </summary>
    private static void Remember(Forms.NotifyIcon? tray, string text)
    {
        if (tray is null) return;
        // 控制字符一律换成空格：托盘提示是单行的，换行会被截断成半句话。
        var line = new string(text.Select(c => char.IsControl(c) ? ' ' : c).ToArray()).Trim();
        // NotifyIcon.Text 有长度上限，超了会抛异常，这里留足余量。
        tray.Text = line.Length <= 60 ? line : line[..59] + "…";
    }

    /// <summary>托盘图标用 sprites 里那只像素手。缩放必须最近邻，插值会把像素画糊成一团。</summary>
    private static Icon LoadTrayIcon()
    {
        try
        {
            var assembly = Assembly.GetExecutingAssembly();
            var name = assembly.GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith("tap-glove.png", StringComparison.OrdinalIgnoreCase));
            if (name is null) return SystemIcons.Application;

            using var stream = assembly.GetManifestResourceStream(name)!;
            using var source = new Bitmap(stream);

            const int size = 32;
            var scale = Math.Min((float)size / source.Width, (float)size / source.Height);
            var w = Math.Max(1, (int)(source.Width * scale));
            var h = Math.Max(1, (int)(source.Height * scale));

            using var square = new Bitmap(size, size);
            using (var g = Graphics.FromImage(square))
            {
                g.InterpolationMode = InterpolationMode.NearestNeighbor;
                g.PixelOffsetMode = PixelOffsetMode.Half;
                g.DrawImage(source, (size - w) / 2, (size - h) / 2, w, h);
            }

            return Icon.FromHandle(square.GetHicon());
        }
        catch
        {
            return SystemIcons.Application;
        }
    }
}
