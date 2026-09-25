using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using System.Windows.Media.Imaging;
using System.Diagnostics;
using Microsoft.Win32;
// UseWindowsForms 把 System.Drawing 也隐式 using 了进来，这两个名字要钉死是 WPF 那边的。
using Color = System.Windows.Media.Color;
using ColorConverter = System.Windows.Media.ColorConverter;

namespace ShoulderTap;

/// <summary>
/// 贴在屏幕右缘的透明覆盖层。全程不接受鼠标、不抢焦点、不进任务栏和 Alt+Tab。
///
/// 只有一只手，没有文字。要说的话早就在聊天里了，屏幕上只需要那一下。
///
/// 只造一次，之后反复 Show/Hide。重建窗口会闪，而且每次都要付一遍分层窗口的初始化。
/// </summary>
public partial class TapWindow : Window
{
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x00000020; // 鼠标穿透
    private const int WS_EX_TOOLWINDOW = 0x00000080; // 不出现在 Alt+Tab
    private const int WS_EX_NOACTIVATE = 0x08000000; // 点不到，也永远不抢焦点

    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

    private const uint MONITOR_DEFAULTTONEAREST = 2;

    /// <summary>淡出用的时间。停留时间（config.json 的 showSec）里最后这 0.24s 在淡出。</summary>
    private const int FadeMs = 240;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public int dwFlags;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    private readonly DispatcherTimer _hide;
    private readonly DispatcherTimer _frames = new() { Interval = TimeSpan.FromMilliseconds(16) };
    private readonly Stopwatch _clock = new();
    private BitmapSource[] _tapSprites = null!;
    private BitmapSource[] _completionSprites = null!;
    private BitmapSource[] _snapSprites = null!;
    private BitmapSource[] _sprites = null!;
    private string _skin = "";
    private static readonly string SkinsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", "skills", "shoulder-tap", "ui", "sprites", "skins");
    private static readonly string ConfigPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", "shoulder-tap", "config.json");
    private static readonly int[] FrameEnds = [250, 340, 430, 580, 670, 760, 910, 1000, 1300];
    /// <summary>响指只有两张图（准备 / 打响）来回切，4fps。</summary>
    private static readonly int[] SnapEnds = [250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250];
    private int[] _ends = FrameEnds;
    private IntPtr _handle;
    private string _habit = "", _node = "";
    private static readonly string HabitScript = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", "skills", "shoulder-tap", "habit.mjs");

    /// <summary>手收回去了。一次性模式靠它决定什么时候可以退出。</summary>
    public event Action? Dismissed;

    /// <param name="lower">true = 挂在 52% 高（拍拍那条道），false = 30%（taptap）。两扇窗同时开也不重叠。</param>
    public TapWindow(bool lower = false)
    {
        InitializeComponent();
        if (lower)
        {
            var rows = ((System.Windows.Controls.Grid)Content).RowDefinitions;
            rows[0].Height = new GridLength(13, GridUnitType.Star);
            rows[2].Height = new GridLength(12, GridUnitType.Star);
        }
        LoadSkin();
        _frames.Tick += (_, _) => {
            var index = Array.FindIndex(_ends, end => _clock.ElapsedMilliseconds < end);
            PixelHand.Source = _sprites[index < 0 ? 8 : index];
            if (index < 0) _frames.Stop();
        };

        _hide = new DispatcherTimer();
        _hide.Tick += (_, _) => Conceal();

        // 习惯提醒下面那两个按钮。鼠标停在字条上就别收，挪开再给一会儿。
        DoneButton.MouseLeftButtonUp += (_, _) => { LogHabitDone(_habit, _node); Conceal(); };
        LaterButton.MouseLeftButtonUp += (_, _) => Conceal();
        CaptionBox.MouseEnter += (_, _) =>
        {
            if (_habit.Length == 0) return;
            _hide.Stop();
            PixelHand.BeginAnimation(OpacityProperty, null); CaptionBox.BeginAnimation(OpacityProperty, null);
            PixelHand.Opacity = CaptionBox.Opacity = 1;
        };
        CaptionBox.MouseLeave += (_, _) =>
        {
            if (_habit.Length == 0 || !IsVisible) return;
            var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(FadeMs)) { BeginTime = TimeSpan.FromMilliseconds(1500) };
            PixelHand.BeginAnimation(OpacityProperty, fade); CaptionBox.BeginAnimation(OpacityProperty, fade);
            _hide.Interval = TimeSpan.FromMilliseconds(1500 + FadeMs + 150);
            _hide.Start();
        };

        // 立刻把句柄造出来。否则第一次拍肩时 PlaceOnActiveScreen 打在空句柄上，
        // SetWindowPos 静默失败，窗口就停在 WPF 的默认位置、默认大小，右半边溢出屏幕。
        new System.Windows.Interop.WindowInteropHelper(this).EnsureHandle();
    }

    /// <summary>config.json 里的 skin，默认 glove。在 shoulder-tap 那一页的「手」里改。</summary>
    public static string CurrentSkin()
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(ConfigPath));
            return doc.RootElement.TryGetProperty("skin", out var s) ? s.GetString() ?? "glove" : "glove";
        }
        catch { return "glove"; }
    }

    /// <summary>
    /// 手和字条在屏幕上停几秒（config.json 的 showSec，默认 8）。在 shoulder-tap 那一页的「手」里改。
    /// 至少要播完一遍动作再加半秒，不然手还没伸完就淡了。
    /// </summary>
    public static int ShowMs(int[] ends)
    {
        var sec = 8.0;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(ConfigPath));
            if (doc.RootElement.TryGetProperty("showSec", out var v) && v.TryGetDouble(out var d)) sec = d;
        }
        catch { }
        return Math.Max(ends[^1] + 500, (int)(Math.Min(sec, 60) * 1000));
    }

    /// <summary>皮肤换了就重读三张 sheet。文件不在就退回内置的 glove。</summary>
    private void LoadSkin()
    {
        var skin = CurrentSkin();
        if (skin == _skin) return;
        _skin = skin;
        _tapSprites = LoadFrames("tap.png");
        _completionSprites = LoadFrames("pat.png");
        _snapSprites = LoadFrames("snap.png");
        _sprites = _tapSprites;
    }

    private BitmapSource[] LoadFrames(string filename)
    {
        var file = Path.Combine(SkinsDir, _skin, filename);
        // 整张读进内存再关文件：不然 WPF 会一直占着 png，用户换皮肤时覆盖不了。
        var sheet = new BitmapImage();
        sheet.BeginInit();
        sheet.CacheOption = BitmapCacheOption.OnLoad;
        sheet.UriSource = File.Exists(file) ? new Uri(file) : new Uri($"pack://application:,,,/shoulder-tap-tap;component/{filename}");
        sheet.EndInit();
        sheet.Freeze();
        // 画布右边留的透明列裁掉：伸得最远的那一帧要真的碰到屏幕边，别离着一截。
        var width = 96 - RightGap(sheet);
        return Enumerable.Range(0, 9).Select(i => {
            var frame = new CroppedBitmap(sheet, new Int32Rect(i * 96, 0, width, 80));
            frame.Freeze();
            return (BitmapSource)frame;
        }).ToArray();
    }

    /// <summary>九帧里离右边最近的那一帧，右边还空着几列透明像素。整张都空就当 0。</summary>
    public static int RightGap(BitmapSource sheet)
    {
        var bgra = new FormatConvertedBitmap(sheet, PixelFormats.Bgra32, null, 0);
        int w = bgra.PixelWidth, h = bgra.PixelHeight, gap = 96;
        var px = new byte[w * h * 4];
        bgra.CopyPixels(px, w * 4, 0);
        for (var f = 0; f < 9; f++)
            for (var x = 95; x >= 96 - gap && x >= 0; x--)
                for (var y = 0; y < h; y++)
                    if (px[(y * w + f * 96 + x) * 4 + 3] > 0) { gap = Math.Min(gap, 95 - x); x = -1; break; }
        return gap == 96 ? 0 : gap;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _handle = new System.Windows.Interop.WindowInteropHelper(this).Handle;

        var ex = (long)GetWindowLongPtr(_handle, GWL_EXSTYLE);
        SetWindowLongPtr(_handle, GWL_EXSTYLE,
            new IntPtr(ex | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE));
    }

    /// <summary>
    /// 拍一下。已经在拍就从头来。
    /// <paramref name="caption"/> 非空时，手旁边多一小条字。敲完停两秒，两个一起淡出。
    /// </summary>
    /// <param name="snap">响指：模型弹了个问题在等你。走 taptap 那条道，换一张 sprite。</param>
    /// <param name="habit">提醒的是这个到点的习惯：字下面放「已经做了 / 还没做」，这一次窗口能点。</param>
    public void Tap(IntPtr anchor = default, bool complete = false, string caption = "", bool snap = false, string habit = "", string node = "")
    {
        _hide.Stop();
        _frames.Stop();
        PixelHand.BeginAnimation(OpacityProperty, null);
        CaptionBox.BeginAnimation(OpacityProperty, null);
        LoadSkin();
        _sprites = complete ? _completionSprites : snap ? _snapSprites : _tapSprites;
        _ends = snap ? SnapEnds : FrameEnds;
        PixelHand.Source = _sprites[0];
        PixelHand.Width = _sprites[0].PixelWidth * 3; // 裁过的宽度，同样三倍像素
        PixelHand.Opacity = 1;
        PixelHand.Visibility = Visibility.Visible;
        CaptionBox.Opacity = 1;

        _habit = caption.Trim().Length > 0 ? habit : ""; // 没字条就没地方放按钮
        _node = node;
        HabitButtons.Visibility = _habit.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        SetClickThrough(_habit.Length == 0);
        CaptionText.Text = caption.Trim();
        CaptionBox.Visibility = caption.Trim().Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        // 两种手势共用 96×80 画布和三倍像素缩放。
        CaptionBox.Margin = new Thickness(0, 0, PixelHand.Width + 12, 0); // 字挂在手左边 12px

        ApplySystemTheme();
        PlaceOnActiveScreen(anchor, complete);

        // ShowActivated=False 加上 WS_EX_NOACTIVATE：你正在打字的那个窗口不会失去焦点。
        if (!IsVisible) Show();

        // 重申置顶：别的 Topmost 窗口（比如刚弹出的通知）可能已经压在上面。
        SetWindowPos(_handle, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);

        var animated = SystemParameters.ClientAreaAnimation;
        var show = ShowMs(_ends);

        if (animated)
        {
            _clock.Restart(); _frames.Start();
            // 播完动作后停着，到 showSec 的最后 0.24s 与字条一起淡出。
            var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(FadeMs)) { BeginTime = TimeSpan.FromMilliseconds(show - FadeMs) };
            PixelHand.BeginAnimation(OpacityProperty, fade);
            CaptionBox.BeginAnimation(OpacityProperty, fade);
        }

        _hide.Interval = TimeSpan.FromMilliseconds(animated ? show + 150 : show); // 动画那边多给一点余量再收
        _hide.Start();
        Program.Log($"tap skin={_skin} complete={complete} snap={snap} habit={_habit} animated={animated} show={show}ms caption=\"{CaptionText.Text}\" visible={IsVisible} hand={PixelHand.Opacity}");
    }

    /// <summary>
    /// 收起来但不销毁：进程继续常驻，下一次拍肩就没有冷启动了。
    /// 动画状态要手动清掉，否则 Storyboard 留下的 hold 值会让下次 Show 出来一帧残影。
    /// </summary>
    private void Conceal()
    {
        _hide.Stop();
        _frames.Stop();
        _habit = "";
        SetClickThrough(true); // 平时整扇窗鼠标穿透，只有带按钮的那一次例外
        PixelHand.Visibility = Visibility.Collapsed;
        CaptionBox.Visibility = Visibility.Collapsed;
        Hide();

        PixelHand.BeginAnimation(OpacityProperty, null);
        CaptionBox.BeginAnimation(OpacityProperty, null);
        PixelHand.Opacity = 0;
        CaptionBox.Opacity = 0;

        Dismissed?.Invoke();
    }

    /// <summary>
    /// 平时鼠标穿透整扇窗；带按钮时关掉穿透。窗口是分层的（AllowsTransparency），
    /// 全透明的像素本来就点不到，所以只有字条那一块接鼠标，屏幕别处照样点得到后面的东西。
    /// </summary>
    private void SetClickThrough(bool through)
    {
        if (_handle == IntPtr.Zero) return;
        var ex = (long)GetWindowLongPtr(_handle, GWL_EXSTYLE);
        SetWindowLongPtr(_handle, GWL_EXSTYLE, new IntPtr(through ? ex | WS_EX_TRANSPARENT : ex & ~WS_EX_TRANSPARENT));
        IsHitTestVisible = !through;
    }

    /// <summary>「已经做了」= 在聊天里说做了：跑 habit.mjs 记一笔 log_habit。后台跑，不等它。</summary>
    private static void LogHabitDone(string habit, string node)
    {
        if (habit.Length == 0) return;
        try
        {
            var start = new ProcessStartInfo(node.Length > 0 ? node : "node") { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add(HabitScript);
            start.ArgumentList.Add("done");
            start.ArgumentList.Add(habit);
            Process.Start(start);
            Program.Log($"habit done {habit}");
        }
        catch (Exception e) { Program.Log($"habit done failed {habit}: {e.Message}"); }
    }

    /// <summary>
    /// 拍在你正在看的那块屏上 —— 取前台窗口所在的显示器，不是主显示器，也不是鼠标所在的。
    /// 鼠标经常忘在别的屏上，前台窗口才是你眼睛在的地方。
    /// </summary>
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    private void PlaceOnActiveScreen(IntPtr anchor, bool complete)
    {
        // 两只手都跟着你的视线走：永远拍在前台窗口所在的那块屏，不管这轮是哪个窗口发起的。
        anchor = GetForegroundWindow();
        if (anchor == IntPtr.Zero) anchor = _handle;

        // 直接问 Win32 要工作区。它给的永远是真实物理像素，不经过任何框架的 DPI 记账。
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(MonitorFromWindow(anchor, MONITOR_DEFAULTTONEAREST), ref info)) return;

        var work = info.rcWork;

        // 用物理像素摆位，绕开 WPF 的 DIP 换算；窗口内部的布局仍按该屏 DPI 自动缩放。
        //
        // 摆两次，不是笔误。跨显示器移动且两块屏缩放不同时，第一次调用会同步触发
        // WM_DPICHANGED，尺寸被按**旧** DPI 换算掉（150% → 100% 时 1920 会缩成 1280）。
        // 等 DPI 切换完再摆第二次，这次才算数。
        for (var pass = 0; pass < 2; pass++)
            SetWindowPos(_handle, HWND_TOPMOST,
                work.Left, work.Top, work.Right - work.Left, work.Bottom - work.Top,
                SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }

    private void ApplySystemTheme()
    {
        var value = Registry.GetValue(
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme", 1);

        var dark = value is int i && i == 0;

        Set("Ink", dark ? "#FAFAFA" : "#181818");
        Set("Bg", dark ? "#171717" : "#FFFFFF");

        void Set(string key, string hex) =>
            ((SolidColorBrush)Resources[key]).Color = (Color)ColorConverter.ConvertFromString(hex)!;
    }
}
