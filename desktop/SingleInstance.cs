using System.IO;
using System.IO.Pipes;

namespace ShoulderTap;

/// <summary>
/// 「没开就开起来，开着就直接拍」这条规则的全部实现。
///
/// 互斥量负责回答「有没有人在跑」，命名管道负责把这一次要说的话交给那个人。
/// 调用方因此永远只有一条命令，不需要自己判断，也不存在两个进程抢同一个窗口。
/// </summary>
public sealed class SingleInstance : IDisposable
{
    // Local\ 而不是 Global\：按登录会话隔离。多用户各拍各的，也不需要管理员权限。
    private const string MutexName = @"Local\shoulder-tap-tap.instance";
    private const string PipeName = "shoulder-tap-tap.ipc";

    private readonly Mutex _mutex;
    private CancellationTokenSource? _stop;

    /// <summary>true = 本进程就是常驻的那个。false = 已经有人在跑，本进程只负责转交。</summary>
    public bool IsOwner { get; }

    public SingleInstance()
    {
        _mutex = new Mutex(true, MutexName, out var created);
        IsOwner = created;
    }

    /// <summary>
    /// 把这次要说的话交给已经在跑的那个进程。
    /// 超时给得比较宽：对方可能正在冷启动，管道还没架好。
    /// </summary>
    public static bool TrySend(TapRequest req, int timeoutMs = 4000)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(timeoutMs);
            using var writer = new StreamWriter(client) { AutoFlush = true };
            writer.Write(req.ToJson());
            return true;
        }
        catch
        {
            // 对方可能已经死了却没释放互斥量。交不出去就交不出去，调用方会自己兜底。
            return false;
        }
    }

    /// <summary>后台收话。每次只服务一个连接，拍肩这种频率不需要并发。</summary>
    public void Listen(Action<TapRequest> onTap)
    {
        _stop = new CancellationTokenSource();
        var token = _stop.Token;

        var thread = new Thread(() =>
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(
                        PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);

                    server.WaitForConnectionAsync(token).GetAwaiter().GetResult();

                    using var reader = new StreamReader(server);
                    var json = reader.ReadToEnd();
                    var req = TapRequest.FromJson(json);
                    if (req != null) onTap(req);
                }
                catch (OperationCanceledException) { return; }
                catch
                {
                    // 单次连接出问题不该让哨兵聋掉，歇一下继续听。
                    if (!token.IsCancellationRequested) Thread.Sleep(200);
                }
            }
        })
        { IsBackground = true, Name = "shoulder-tap ipc" };

        thread.Start();
    }

    public void Dispose()
    {
        _stop?.Cancel();
        try { if (IsOwner) _mutex.ReleaseMutex(); } catch { }
        _mutex.Dispose();
    }
}
