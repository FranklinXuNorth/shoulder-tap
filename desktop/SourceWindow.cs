using System.Runtime.InteropServices;

namespace ShoulderTap;

internal static class SourceWindow
{
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr data);
    private delegate bool EnumWindow(IntPtr hwnd, IntPtr data);
    [DllImport("kernel32.dll")] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Entry
    {
        public uint Size, Usage, Pid;
        public UIntPtr Heap;
        public uint Module, Threads, Parent;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Exe;
    }

    // Prefer the actual caller's ancestor window; foreground is only a submit-time fallback.
    internal static IntPtr Resolve(int sourcePid)
    {
        var parents = new Dictionary<uint, uint>();
        var snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot != new IntPtr(-1))
        {
            try
            {
                var entry = new Entry { Size = (uint)Marshal.SizeOf<Entry>(), Exe = "" };
                if (Process32FirstW(snapshot, ref entry))
                    do { parents[entry.Pid] = entry.Parent; } while (Process32NextW(snapshot, ref entry));
            }
            finally { CloseHandle(snapshot); }
        }
        var seen = new HashSet<uint>();
        var pid = (uint)Math.Max(0, sourcePid);
        while (pid != 0 && seen.Add(pid))
        {
            var matches = new List<IntPtr>();
            EnumWindows((hwnd, _) => {
                GetWindowThreadProcessId(hwnd, out var owner);
                if (owner == pid && IsWindowVisible(hwnd)) matches.Add(hwnd);
                return true;
            }, IntPtr.Zero);
            if (matches.Count == 1) return matches[0];
            if (matches.Contains(GetForegroundWindow())) return GetForegroundWindow();
            if (!parents.TryGetValue(pid, out pid)) break;
        }
        return IntPtr.Zero;
    }
}
