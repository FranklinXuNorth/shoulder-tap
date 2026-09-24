using System.IO;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace ShoulderTap;

/// <summary>
/// 跨机器那条线的接收端。常驻进程挂在中转的 WebSocket 上：
/// 收到密文就解开、当成一次本机拍肩；本机一有键鼠输入就告诉服务端「我是活跃的那台」。
///
/// 密钥从 Notion token 派生（HKDF-SHA256 空盐，info = shoulder-tap/key），
/// 封装是 AES-256-GCM，iv(12)|密文|tag(16)，跟 relay.mjs 一字不差。
/// 没配 SHOULDER_TAP_RELAY 或没登录，就整个不启动，桌面端退回单机行为。
/// </summary>
public sealed class Relay : IDisposable
{
    private static readonly string Home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private static readonly string StateDir = Path.Combine(Home, ".claude", "shoulder-tap");
    private static readonly string[] EnvFiles =
    {
        Path.Combine(Home, ".claude", "skills", "shoulder-tap", ".env"),
        Path.Combine(StateDir, ".env"),
    };

    /// <summary>给 watch.mjs 看的：现在活跃的是不是本机。是，钩子就直接在本机拍，不绕云端。</summary>
    private static readonly string ActiveFile = Path.Combine(StateDir, "active.json");

    /// <summary>键鼠停了超过这么久，就不算「刚被碰过」。</summary>
    private const int RecentInputMs = 1500;

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    private readonly Uri _endpoint;
    private readonly string _token;
    private readonly byte[] _key;
    private readonly string _device;
    private readonly bool _telemetry;
    private readonly Action<TapRequest> _deliver;
    private readonly CancellationTokenSource _stop = new();
    private readonly DispatcherTimer _watch = new() { Interval = TimeSpan.FromSeconds(1) };
    private ClientWebSocket? _ws;
    private bool _active;
    private IntPtr _screen;

    private Relay(Uri endpoint, string token, byte[] key, string device, bool telemetry, Action<TapRequest> deliver)
    {
        _endpoint = endpoint; _token = token; _key = key; _device = device; _telemetry = telemetry; _deliver = deliver;
        _watch.Tick += (_, _) => Observe();
    }

    /// <summary>读 .env 和 state.json。缺任何一样就返回 null，调用方当没有这条线。</summary>
    public static Relay? Load(Action<TapRequest> deliver)
    {
        var env = LoadEnv();
        env.TryGetValue("SHOULDER_TAP_RELAY", out var relay);
        env.TryGetValue("SHOULDER_TAP_DEVICE_TOKEN", out var token);
        env.TryGetValue("NOTION_TOKEN", out var notion);
        if (string.IsNullOrWhiteSpace(relay) || string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(notion)) return null;
        if (!Uri.TryCreate(relay.Trim().TrimEnd('/'), UriKind.Absolute, out var uri)) return null;
        var ws = new UriBuilder(uri) { Scheme = uri.Scheme == "http" ? "ws" : "wss", Path = uri.AbsolutePath.TrimEnd('/') + "/ch" };
        var telemetry = !(env.TryGetValue("SHOULDER_TAP_TELEMETRY", out var t) && t.Trim() == "0");
        return new Relay(ws.Uri, token.Trim(), KeyOf(notion.Trim()), DeviceId(), telemetry, deliver);
    }

    public void Start()
    {
        _ = LoopAsync();
        _watch.Start();
    }

    public void Dispose()
    {
        _watch.Stop();
        _stop.Cancel();
        try { _ws?.Abort(); } catch { }
        WriteActive(false);
    }

    private void WriteActive(bool active)
    {
        _active = active;
        try
        {
            Directory.CreateDirectory(StateDir);
            File.WriteAllText(ActiveFile, JsonSerializer.Serialize(new { active, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
        }
        catch { }
    }

    /// <summary>
    /// 本机直接拍的那一下也记进频道的历史，跟经中转的一样：手势明文（统计用），字条密文。
    /// 连接不在就算了，历史不值得排队。
    /// </summary>
    public void Record(TapRequest req)
    {
        var ws = _ws;
        if (ws is null || ws.State != WebSocketState.Open) return;
        var blob = Seal(_key, JsonSerializer.Serialize(new { host = Environment.MachineName, gesture = req.Mode, caption = req.Caption, text = req.Text }));
        var line = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { type = "record", gesture = req.Mode, blob }));
        _ = ws.SendAsync(line, WebSocketMessageType.Text, true, _stop.Token).ContinueWith(t => { if (t.IsFaulted) Program.Log("relay record " + t.Exception?.GetBaseException().Message); });
    }

    // ---------- 密钥与封装：跟 relay.mjs 对齐 ----------

    public static byte[] KeyOf(string notionToken) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(notionToken), 32, Array.Empty<byte>(), Encoding.UTF8.GetBytes("shoulder-tap/key"));

    public static string Seal(byte[] key, string plain)
    {
        var iv = RandomNumberGenerator.GetBytes(12);
        var body = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[body.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(key, 16);
        aes.Encrypt(iv, body, cipher, tag);
        return Convert.ToBase64String(iv.Concat(cipher).Concat(tag).ToArray());
    }

    public static string Unseal(byte[] key, string blob)
    {
        var raw = Convert.FromBase64String(blob);
        var iv = raw.AsSpan(0, 12);
        var tag = raw.AsSpan(raw.Length - 16);
        var body = raw.AsSpan(12, raw.Length - 28);
        var plain = new byte[body.Length];
        using var aes = new AesGcm(key, 16);
        aes.Decrypt(iv, body, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }

    // ---------- 连接 ----------

    private async Task LoopAsync()
    {
        var delay = 1000;
        while (!_stop.IsCancellationRequested)
        {
            try
            {
                using var ws = new ClientWebSocket();
                ws.Options.SetRequestHeader("Authorization", "Bearer " + _token);
                _ws = ws;
                var url = new UriBuilder(_endpoint) { Query = $"device={_device}&platform=win&screens={Forms.Screen.AllScreens.Length}&t={(_telemetry ? 1 : 0)}" };
                await ws.ConnectAsync(url.Uri, _stop.Token);
                Program.Log("relay connected");
                delay = 1000;
                var buffer = new byte[64 * 1024];
                while (ws.State == WebSocketState.Open && !_stop.IsCancellationRequested)
                {
                    var text = await ReceiveAsync(ws, buffer);
                    if (text is null) break;
                    Handle(text);
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { Program.Log("relay " + e.Message); }
            _ws = null;
            WriteActive(false);
            try { await Task.Delay(delay, _stop.Token); } catch { break; }
            delay = Math.Min(delay * 2, 30_000); // 断了就退避重连，最多半分钟一次
        }
    }

    private async Task<string?> ReceiveAsync(ClientWebSocket ws, byte[] buffer)
    {
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await ws.ReceiveAsync(buffer, _stop.Token);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            stream.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private void Handle(string text)
    {
        JsonNode? msg;
        try { msg = JsonNode.Parse(text); } catch { return; }
        var type = msg?["type"]?.GetValue<string>();

        if (type == "active")
        {
            // 服务端说了算：不是我，下次被碰到就得重新报。
            WriteActive(msg?["device"]?.GetValue<string>() == _device);
            return;
        }
        if (type != "tap") return;

        string plain;
        try { plain = Unseal(_key, msg?["blob"]?.GetValue<string>() ?? ""); }
        catch (Exception e) { Program.Log("relay unseal failed: " + e.Message); return; }

        JsonNode? body;
        try { body = JsonNode.Parse(plain); } catch { return; }
        var host = body?["host"]?.GetValue<string>() ?? "";
        var gesture = body?["gesture"]?.GetValue<string>() ?? "tap";
        var caption = body?["caption"]?.GetValue<string>() ?? "";
        var tapText = body?["text"]?.GetValue<string>() ?? "";

        // 别的机器发来的，字条前面带上它的名字：知道是哪台的 agent 在叫你。
        var remote = !string.Equals(host, Environment.MachineName, StringComparison.OrdinalIgnoreCase);
        if (remote) caption = caption.Length > 0 ? $"[{host}] {caption}" : $"[{host}]";

        _deliver(new TapRequest
        {
            Mode = gesture is "complete" or "snap" ? gesture : "tap",
            Text = tapText.Length > 0 ? tapText : caption,
            Caption = caption,
            FromRelay = true,
        });
    }

    // ---------- 活跃上报 ----------

    /// <summary>
    /// 每秒看一眼：刚有键鼠输入，而且（我不是活跃的那台，或者前台窗口换了块屏）→ 报一次。
    /// 只上报「被碰了」和屏幕数，不上报坐标，也不上报窗口。
    /// </summary>
    private void Observe()
    {
        var ws = _ws;
        if (ws is null || ws.State != WebSocketState.Open) return;

        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref info)) return;
        var idle = unchecked((uint)Environment.TickCount - info.dwTime);
        if (idle > RecentInputMs) return;

        var screen = MonitorFromWindow(GetForegroundWindow(), 2 /* MONITOR_DEFAULTTONEAREST */);
        if (_active && screen == _screen) return;

        _screen = screen;
        WriteActive(true); // 先当作是我，服务端广播回来会纠正
        var line = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { type = "active", screens = Forms.Screen.AllScreens.Length }));
        _ = ws.SendAsync(line, WebSocketMessageType.Text, true, _stop.Token).ContinueWith(t => { if (t.IsFaulted) Program.Log("relay send " + t.Exception?.GetBaseException().Message); });
    }

    // ---------- 配置 ----------

    private static Dictionary<string, string> LoadEnv()
    {
        var env = new Dictionary<string, string>();
        foreach (System.Collections.DictionaryEntry e in Environment.GetEnvironmentVariables())
            env[(string)e.Key] = (string?)e.Value ?? "";
        foreach (var file in EnvFiles)
        {
            if (!File.Exists(file)) continue;
            foreach (var line in File.ReadAllLines(file))
            {
                if (line.TrimStart().StartsWith('#')) continue;
                var m = Regex.Match(line, @"^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$");
                if (m.Success) env[m.Groups[1].Value] = m.Groups[2].Value.Trim('"', '\'');
            }
        }
        return env;
    }

    /// <summary>跟 watch.mjs 共用 state.json 里的 device；谁先跑到谁生成。</summary>
    private static string DeviceId()
    {
        var path = Path.Combine(StateDir, "state.json");
        JsonObject state;
        try { state = JsonNode.Parse(File.ReadAllText(path)) as JsonObject ?? new JsonObject(); }
        catch { state = new JsonObject(); }
        var device = state["device"]?.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(device)) return device;
        device = Guid.NewGuid().ToString();
        state["device"] = device;
        try
        {
            Directory.CreateDirectory(StateDir);
            File.WriteAllText(path, state.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
        return device;
    }
}
