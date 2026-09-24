using System.Text.Json;
using System.Text.Json.Serialization;

namespace ShoulderTap;

/// <summary>
/// 一次「拍肩」。命令行进来，可能经由命名管道转交给已经在跑的那个进程。
///
/// 屏幕上不显示任何文字，所以 <see cref="Text"/> 只有两个作用：
/// 表示「这次是来拍的，不是来常驻的」，以及落进托盘提示，让你事后想看一眼时有处可看。
/// </summary>
public sealed class TapRequest
{
    public string Mode { get; set; } = "tap";
    public string Session { get; set; } = "";
    public long WindowHandle { get; set; }
    public int SourcePid { get; set; }
    [JsonPropertyName("text")] public string Text { get; set; } = "";

    /// <summary>手旁边那一小条字：现在聚焦哪条、这轮干了什么。有它，手敲完会多停两秒。</summary>
    [JsonPropertyName("caption")] public string Caption { get; set; } = "";

    /// <summary>true = 不是来拍肩的，是来让常驻进程退出的。</summary>
    [JsonPropertyName("quit")] public bool Quit { get; set; }

    /// <summary>没有正文就不值得占屏幕：这一次只是把进程拉起来常驻。</summary>
    // 响指和拍拍本身就是消息，不带文字也要演；只有 taptap 需要一句话才值得拍
    [JsonIgnore] public bool HasMessage => Mode is "complete" or "snap" or "today" || !string.IsNullOrWhiteSpace(Text);

    public string ToJson() => JsonSerializer.Serialize(this);

    public static TapRequest? FromJson(string json)
    {
        try { return JsonSerializer.Deserialize<TapRequest>(json); }
        catch { return null; }
    }

    /// <summary>
    /// 解析 --text / --quit。
    /// 刻意宽松：这东西是被脚本和模型调的，解析失败弹个错误框比什么都不做更烦人，
    /// 所以不认识的参数一律忽略。
    /// </summary>
    public static TapRequest FromArgs(string[] args)
    {
        var req = new TapRequest();
        for (var i = 0; i < args.Length; i++)
        {
            var key = args[i].TrimStart('-').ToLowerInvariant();
            string Next() => i + 1 < args.Length ? args[++i] : "";
            switch (key)
            {
                case "mode": req.Mode = Next(); break;
                case "session": req.Session = Next(); break;
                case "window": if (long.TryParse(Next(), out var hwnd)) req.WindowHandle = hwnd; break;
                case "source-pid": if (int.TryParse(Next(), out var pid)) req.SourcePid = pid; break;
                case "text": case "t": req.Text = Next(); break;
                case "caption": req.Caption = Next(); break;
                case "quit": case "exit": req.Quit = true; break;
            }
        }
        return req;
    }
}
