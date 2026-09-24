using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using System.Diagnostics;
using Button = System.Windows.Controls.Button;
using Brushes = System.Windows.Media.Brushes;

namespace ShoulderTap;

public sealed class TodayWindow : Window
{
    private readonly TextBlock _tasks = new() { TextWrapping = TextWrapping.Wrap, FontSize = 16, LineHeight = 28 };
    private readonly TextBlock _history = new() { TextWrapping = TextWrapping.Wrap, FontSize = 13, LineHeight = 22, Foreground = Brushes.DimGray, Margin = new Thickness(0, 4, 0, 0) };
    private readonly TextBlock _status = new() { TextWrapping = TextWrapping.Wrap, FontSize = 12, Foreground = Brushes.DimGray };
    private readonly Button _refresh = new() { Content = "刷新", Padding = new Thickness(12, 5, 12, 5) };
    private readonly DispatcherTimer _poll = new() { Interval = TimeSpan.FromSeconds(1) };
    private static readonly string Home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private static readonly string State = Path.Combine(Home, ".claude", "shoulder-tap", "state.json");

    public TodayWindow()
    {
        Title = "Shoulder Tap · 今日待办";
        Width = 420; Height = 490; MinWidth = 300; MinHeight = 220;
        Topmost = true; ShowInTaskbar = false;
        Background = Brushes.FloralWhite;
        var layout = new DockPanel { Margin = new Thickness(24) };
        var header = new DockPanel { Margin = new Thickness(0, 0, 0, 20) };
        DockPanel.SetDock(_refresh, Dock.Right); header.Children.Add(_refresh);
        var hands = new Button { Content = "手的样式", Padding = new Thickness(12, 5, 12, 5), Margin = new Thickness(0, 0, 8, 0) };
        hands.Click += (_, _) => Program.OpenSettings("--hands");
        DockPanel.SetDock(hands, Dock.Right); header.Children.Add(hands);
        header.Children.Add(new TextBlock { Text = "今天要做的事", FontSize = 22, FontWeight = FontWeights.SemiBold });
        DockPanel.SetDock(header, Dock.Top); layout.Children.Add(header);
        DockPanel.SetDock(_status, Dock.Bottom); _status.Margin = new Thickness(0, 16, 0, 0); layout.Children.Add(_status);
        var body = new StackPanel();
        body.Children.Add(_tasks);
        body.Children.Add(new TextBlock { Text = "习惯记录", FontSize = 15, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 22, 0, 0) });
        body.Children.Add(_history);
        layout.Children.Add(new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        Content = layout;
        _refresh.Click += async (_, _) => await RefreshAsync();
        _poll.Tick += (_, _) => LoadPlan();
        IsVisibleChanged += async (_, _) => {
            if (IsVisible) { LoadPlan(); _poll.Start(); await RefreshAsync(); }
            else _poll.Stop();
        };
        Closing += (_, e) => { e.Cancel = true; Hide(); };
    }

    public void Reveal()
    {
        if (!IsVisible)
        {
            var screen = System.Windows.Forms.Screen.FromHandle(SourceWindow.GetForegroundWindow()).WorkingArea;
            Opacity = 0;
            Show();
            var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            // Position in physical pixels, then repeat after the monitor's DPI transition.
            for (var pass = 0; pass < 2; pass++)
            {
                var dpi = VisualTreeHelper.GetDpi(this);
                var width = Math.Min(screen.Width - 40, (int)(Width * dpi.DpiScaleX));
                var height = Math.Min(screen.Height - 40, (int)(Height * dpi.DpiScaleY));
                // 开在你正看着的那块屏幕正中间。
                SourceWindow.SetWindowPos(hwnd, new IntPtr(-1), screen.Left + (screen.Width - width) / 2,
                    screen.Top + (screen.Height - height) / 2, width, height, 0x0010);
            }
            Opacity = 1;
        }
        // Hook-launched daemons can inherit SW_HIDE; explicitly reveal this user-requested window.
        SourceWindow.ShowWindow(new System.Windows.Interop.WindowInteropHelper(this).Handle, 5);
        Activate();
    }

    // Display only the plan block; never show model instructions or the activity placeholder.
    public static string PlanText(string plan)
    {
        var match = Regex.Match(plan, @"(?m)^\d{4}-\d{2}-\d{2}(?: 说好要做的事：|：还没有记录任何事。)");
        if (!match.Success) return "还没有可显示的待办，点击刷新同步。";
        var block = plan[match.Index..];
        var end = Regex.Match(block, @"(?m)^(?:用户现在要做的是|【)");
        return (end.Success ? block[..end.Index] : block).Trim();
    }

    private void LoadPlan()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(State));
            _tasks.Text = PlanText(doc.RootElement.GetProperty("plan").GetString() ?? "");
            _history.Text = doc.RootElement.TryGetProperty("history", out var h) ? h.GetString() ?? "" : "点刷新拿一次记录。";
            var at = DateTimeOffset.FromUnixTimeMilliseconds(doc.RootElement.GetProperty("planAt").GetInt64()).LocalDateTime;
            var today = DateTime.Now.AddHours(-4).ToString("yyyy-MM-dd");
            var stale = !_tasks.Text.StartsWith(today);
            _status.Text = (stale ? "这是之前的清单，请刷新今天的待办。\n" : "") + $"上次同步 {at:MM-dd HH:mm} · 清单按凌晨 4 点换日";
        }
        catch { if (string.IsNullOrEmpty(_tasks.Text)) _tasks.Text = "还没有同步到待办，点击刷新试试。"; }
    }

    private async Task RefreshAsync()
    {
        if (!_refresh.IsEnabled) return;
        _refresh.IsEnabled = false;
        var previous = File.Exists(State) ? File.GetLastWriteTimeUtc(State) : DateTime.MinValue;
        try
        {
            var script = Path.Combine(Home, ".claude", "skills", "shoulder-tap", "watch.mjs");
            var start = new ProcessStartInfo("node") { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add(script); start.ArgumentList.Add("--refresh");
            using var process = Process.Start(start);
            if (process is not null)
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                try { await process.WaitForExitAsync(timeout.Token); }
                catch (OperationCanceledException) { process.Kill(); }
            }
            LoadPlan();
            if (!File.Exists(State) || File.GetLastWriteTimeUtc(State) <= previous)
                _status.Text += "\n暂时无法同步，保留上次的清单。";
        }
        catch { _status.Text = "暂时无法同步，保留上次的清单。"; }
        finally { _refresh.IsEnabled = true; }
    }
}
