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

    /// <summary>三下 1.46s，陪字条停 2s，淡出 0.24s；多给一点余量再收。</summary>
    private static readonly TimeSpan Played = TimeSpan.FromMilliseconds(3750);

    /// <summary>系统关了动画时，静止的手停这么久就够了。</summary>
    private static readonly TimeSpan Still = TimeSpan.FromMilliseconds(3200);

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
    private readonly BitmapSource[] _sprites;
    private static readonly int[] FrameEnds = [250, 340, 430, 580, 670, 760, 910, 1000, 1300];
    private IntPtr _handle;

    /// <summary>手收回去了。一次性模式靠它决定什么时候可以退出。</summary>
    public event Action? Dismissed;

    public TapWindow()
    {
        InitializeComponent();
        var sheet = new BitmapImage(new Uri("pack://application:,,,/completion-hand-sheet.png"));
        _sprites = Enumerable.Range(0, 9).Select(i => (BitmapSource)new CroppedBitmap(sheet,
            new Int32Rect(i * 96, 0, 96, 80))).ToArray();
        _frames.Tick += (_, _) => {
            var index = Array.FindIndex(FrameEnds, end => _clock.ElapsedMilliseconds < end);
            CompletionHand.Source = _sprites[index < 0 ? 8 : index];
        };

        _hide = new DispatcherTimer();
        _hide.Tick += (_, _) => Conceal();

        // 立刻把句柄造出来。否则第一次拍肩时 PlaceOnActiveScreen 打在空句柄上，
        // SetWindowPos 静默失败，窗口就停在 WPF 的默认位置、默认大小，右半边溢出屏幕。
        new System.Windows.Interop.WindowInteropHelper(this).EnsureHandle();
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
    public void Tap(IntPtr anchor = default, bool complete = false, string caption = "")
    {
        _hide.Stop();
        _frames.Stop();
        ((Storyboard)Resources["TapStory"]).Stop(this);
        Hand.Opacity = 0;
        CompletionHand.Visibility = complete ? Visibility.Visible : Visibility.Collapsed;

        CaptionText.Text = caption.Trim();
        CaptionBox.Visibility = caption.Trim().Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        // 字条贴在手的左边：两只手宽度不一样，边距跟着换。
        CaptionBox.Margin = new Thickness(0, 0, complete ? 300 : 236, 0);

        ApplySystemTheme();
        PlaceOnActiveScreen(anchor, complete);

        // ShowActivated=False 加上 WS_EX_NOACTIVATE：你正在打字的那个窗口不会失去焦点。
        if (!IsVisible) Show();

        // 重申置顶：别的 Topmost 窗口（比如刚弹出的通知）可能已经压在上面。
        SetWindowPos(_handle, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);

        var animated = SystemParameters.ClientAreaAnimation;

        if (complete)
        {
            CompletionHand.Source = _sprites[0];
            if (animated)
            {
                _clock.Restart(); _frames.Start();
                CaptionBox.Opacity = 1; // 像素手不走 Storyboard，字条得自己亮起来
                // 像素手 1.3s 放完，停 2s，然后和字条一起淡出。
                var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(240)) { BeginTime = TimeSpan.FromMilliseconds(3300) };
                CompletionHand.BeginAnimation(OpacityProperty, fade);
                CaptionBox.BeginAnimation(OpacityProperty, fade);
            }
            else CaptionBox.Opacity = 1;
        }
        else if (animated) ((Storyboard)Resources["TapStory"]).Begin(this, true); // 字条的淡入淡出也在这条时间轴里
        else { Hand.Opacity = 1; CaptionBox.Opacity = 1; } // 系统关了动画就别硬演，静静地出现一下

        _hide.Interval = animated ? Played : Still;
        _hide.Start();
        Program.Log($"tap complete={complete} animated={animated} caption=\"{CaptionText.Text}\" visible={IsVisible} hand={Hand.Opacity}");
    }

    /// <summary>
    /// 收起来但不销毁：进程继续常驻，下一次拍肩就没有冷启动了。
    /// 动画状态要手动清掉，否则 Storyboard 留下的 hold 值会让下次 Show 出来一帧残影。
    /// </summary>
    private void Conceal()
    {
        _hide.Stop();
        _frames.Stop();
        CompletionHand.Visibility = Visibility.Collapsed;
        CaptionBox.Visibility = Visibility.Collapsed;
        Hide();

        ((Storyboard)Resources["TapStory"]).Stop(this);
        CompletionHand.BeginAnimation(OpacityProperty, null); // 摘掉淡出动画，属性才重新听本地值
        CaptionBox.BeginAnimation(OpacityProperty, null);
        Hand.Opacity = 0;
        CaptionBox.Opacity = 0;
        GestureShift.X = 0;
        Marks.Opacity = 0;

        Dismissed?.Invoke();
    }

    /// <summary>
    /// 拍在你正在看的那块屏上 —— 取前台窗口所在的显示器，不是主显示器，也不是鼠标所在的。
    /// 鼠标经常忘在别的屏上，前台窗口才是你眼睛在的地方。
    /// </summary>
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    private void PlaceOnActiveScreen(IntPtr anchor, bool complete)
    {
        if (anchor == IntPtr.Zero) anchor = GetForegroundWindow();
        if (anchor == IntPtr.Zero) anchor = _handle;

        // 直接问 Win32 要工作区。它给的永远是真实物理像素，不经过任何框架的 DPI 记账。
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(MonitorFromWindow(anchor, MONITOR_DEFAULTTONEAREST), ref info)) return;

        var work = info.rcWork;
        if (complete && !SourceWindow.IsIconic(anchor) && GetWindowRect(anchor, out var bounds))
        {
            var clipped = new RECT { Left = Math.Max(work.Left, bounds.Left), Top = Math.Max(work.Top, bounds.Top),
                Right = Math.Min(work.Right, bounds.Right), Bottom = Math.Min(work.Bottom, bounds.Bottom) };
            if (clipped.Right > clipped.Left && clipped.Bottom > clipped.Top) work = clipped;
        }

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
