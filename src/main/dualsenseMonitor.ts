const DUALSENSE_RAW_INPUT_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public static class OrbitDualSenseRawInput
{
    private const uint RID_INPUT = 0x10000003;
    private const uint RIDI_DEVICENAME = 0x20000007;
    private const uint RIM_TYPEHID = 2;
    private const uint RIDEV_INPUTSINK = 0x00000100;
    private const uint RIDEV_DEVNOTIFY = 0x00002000;
    private const int WM_INPUT = 0x00FF;
    private const int WM_INPUT_DEVICE_CHANGE = 0x00FE;
    private const int GIDC_REMOVAL = 2;
    private const int PS_BUTTON_DIAGNOSTIC_MASK = 0x10000;

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICE
    {
        public ushort usUsagePage;
        public ushort usUsage;
        public uint dwFlags;
        public IntPtr hwndTarget;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTHEADER
    {
        public uint dwType;
        public uint dwSize;
        public IntPtr hDevice;
        public IntPtr wParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICELIST
    {
        public IntPtr hDevice;
        public uint dwType;
    }

    private sealed class PressState
    {
        public bool Pressed;
        public bool Triggered;
        public long PressedAt;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices(
        [In] RAWINPUTDEVICE[] devices,
        uint deviceCount,
        uint structureSize);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(
        IntPtr rawInput,
        uint command,
        IntPtr data,
        ref uint size,
        uint headerSize);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetRawInputDeviceInfo(
        IntPtr device,
        uint command,
        StringBuilder data,
        ref uint size);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputDeviceList(
        IntPtr devices,
        ref uint deviceCount,
        uint structureSize);

    private static readonly object StartLock = new object();
    private static readonly ManualResetEventSlim Ready = new ManualResetEventSlim(false);
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static Thread messageThread;
    private static bool available;
    private static int holdMilliseconds;

    public static int LastErrorCode { get; private set; }

    public static bool Start(int requestedHoldMilliseconds)
    {
        lock (StartLock)
        {
            if (messageThread != null)
                return available;

            holdMilliseconds = Math.Max(250, requestedHoldMilliseconds);
            messageThread = new Thread(RunMessageLoop);
            messageThread.IsBackground = true;
            messageThread.Name = "ORBIT DualSense Raw Input";
            messageThread.SetApartmentState(ApartmentState.STA);
            messageThread.Start();
        }

        return Ready.Wait(TimeSpan.FromSeconds(5)) && available;
    }

    private static void RunMessageLoop()
    {
        OrbitDualSenseWindow window = null;
        try
        {
            window = new OrbitDualSenseWindow(holdMilliseconds);
            available = window.Initialize();
            if (available)
            {
                Emit("ready");
                window.ReportConnectedControllers(true);
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            available = false;
        }
        finally
        {
            Ready.Set();
        }

        if (available && window != null)
            Application.Run();
    }

    private static void Emit(string message)
    {
        Console.WriteLine(message);
        Console.Out.Flush();
    }

    /** Supports DualSense USB, enhanced Bluetooth and simple Bluetooth reports. */
    public static bool IsPsButtonPressed(byte[] report)
    {
        if (report == null || report.Length == 0)
            return false;

        if (report[0] == 0x31 && report.Length > 11)
            return (report[11] & 0x01) != 0;

        if (report[0] == 0x01)
        {
            if ((report.Length == 10 || report.Length == 78) && report.Length > 7)
                return (report[7] & 0x01) != 0;
            if (report.Length > 10)
                return (report[10] & 0x01) != 0;
        }

        // Some Raw Input drivers omit the report ID from the packet.
        if (report.Length == 63)
            return (report[9] & 0x01) != 0;
        if (report.Length == 77)
            return (report[10] & 0x01) != 0;
        if (report.Length == 9)
            return (report[6] & 0x01) != 0;

        return false;
    }

    private sealed class OrbitDualSenseWindow : NativeWindow
    {
        private readonly Dictionary<IntPtr, string> deviceNames = new Dictionary<IntPtr, string>();
        private readonly Dictionary<IntPtr, PressState> pressStates = new Dictionary<IntPtr, PressState>();
        private readonly int requiredHoldMilliseconds;
        private readonly System.Windows.Forms.Timer holdTimer;
        private int lastConnectedCount = -1;

        public OrbitDualSenseWindow(int requestedHoldMilliseconds)
        {
            requiredHoldMilliseconds = requestedHoldMilliseconds;
            holdTimer = new System.Windows.Forms.Timer();
            holdTimer.Interval = 40;
            holdTimer.Tick += delegate { CheckHeldButtons(); };
        }

        public bool Initialize()
        {
            CreateParams parameters = new CreateParams();
            parameters.Caption = "ORBIT DualSense Raw Input";
            parameters.Parent = new IntPtr(-3); // HWND_MESSAGE
            CreateHandle(parameters);

            RAWINPUTDEVICE[] devices = new RAWINPUTDEVICE[2];
            devices[0].usUsagePage = 0x01;
            devices[0].usUsage = 0x05; // Game pad
            devices[0].dwFlags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY;
            devices[0].hwndTarget = Handle;
            devices[1].usUsagePage = 0x01;
            devices[1].usUsage = 0x04; // Joystick
            devices[1].dwFlags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY;
            devices[1].hwndTarget = Handle;

            bool registered = RegisterRawInputDevices(
                devices,
                (uint)devices.Length,
                (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)));
            if (registered)
                holdTimer.Start();
            else
                LastErrorCode = Marshal.GetLastWin32Error();
            return registered;
        }

        public void ReportConnectedControllers(bool force)
        {
            int count = CountConnectedDualSenseControllers();
            if (!force && count == lastConnectedCount)
                return;
            lastConnectedCount = count;
            Emit("controllers:" + count);
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WM_INPUT)
                HandleRawInput(message.LParam);
            else if (message.Msg == WM_INPUT_DEVICE_CHANGE)
            {
                if (message.WParam.ToInt32() == GIDC_REMOVAL)
                {
                    deviceNames.Remove(message.LParam);
                    pressStates.Remove(message.LParam);
                }
                ReportConnectedControllers(false);
            }

            base.WndProc(ref message);
        }

        private void HandleRawInput(IntPtr rawInputHandle)
        {
            uint size = 0;
            uint headerSize = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
            uint queryResult = GetRawInputData(
                rawInputHandle,
                RID_INPUT,
                IntPtr.Zero,
                ref size,
                headerSize);
            if (queryResult == UInt32.MaxValue || size < headerSize + 8)
                return;

            IntPtr buffer = Marshal.AllocHGlobal((int)size);
            try
            {
                uint readSize = size;
                uint readResult = GetRawInputData(
                    rawInputHandle,
                    RID_INPUT,
                    buffer,
                    ref readSize,
                    headerSize);
                if (readResult == UInt32.MaxValue || readResult < headerSize + 8)
                    return;

                RAWINPUTHEADER header = (RAWINPUTHEADER)Marshal.PtrToStructure(
                    buffer,
                    typeof(RAWINPUTHEADER));
                if (header.dwType != RIM_TYPEHID || !IsDualSenseDevice(header.hDevice))
                    return;

                int hidOffset = (int)headerSize;
                uint reportSize = (uint)Marshal.ReadInt32(buffer, hidOffset);
                uint reportCount = (uint)Marshal.ReadInt32(buffer, hidOffset + 4);
                if (reportSize == 0 || reportCount == 0)
                    return;

                long totalReportBytes = (long)reportSize * reportCount;
                if (totalReportBytes > readResult - headerSize - 8)
                    return;

                int reportsOffset = hidOffset + 8;
                bool pressed = false;
                for (uint reportIndex = 0; reportIndex < reportCount; reportIndex++)
                {
                    byte[] report = new byte[reportSize];
                    Marshal.Copy(
                        IntPtr.Add(buffer, reportsOffset + (int)(reportIndex * reportSize)),
                        report,
                        0,
                        (int)reportSize);
                    pressed = IsPsButtonPressed(report);
                }

                UpdatePressedState(header.hDevice, pressed);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private void UpdatePressedState(IntPtr device, bool pressed)
        {
            PressState state;
            if (!pressStates.TryGetValue(device, out state))
            {
                state = new PressState();
                pressStates[device] = state;
            }

            if (pressed == state.Pressed)
                return;

            long now = Clock.ElapsedMilliseconds;
            state.Pressed = pressed;
            if (pressed)
            {
                state.PressedAt = now;
                state.Triggered = false;
                Emit("buttons:0:" + PS_BUTTON_DIAGNOSTIC_MASK);
                Emit("pressed:0");
            }
            else
            {
                long duration = Math.Max(0, now - state.PressedAt);
                Emit("released:0:" + duration);
                state.Triggered = false;
            }
        }

        private void CheckHeldButtons()
        {
            long now = Clock.ElapsedMilliseconds;
            foreach (PressState state in pressStates.Values)
            {
                if (!state.Pressed || state.Triggered || now - state.PressedAt < requiredHoldMilliseconds)
                    continue;
                state.Triggered = true;
                Emit("trigger");
            }
        }

        private bool IsDualSenseDevice(IntPtr device)
        {
            string name;
            if (!deviceNames.TryGetValue(device, out name))
            {
                name = ReadDeviceName(device);
                deviceNames[device] = name;
            }
            return IsDualSenseDeviceName(name);
        }

        private static bool IsDualSenseDeviceName(string name)
        {
            if (String.IsNullOrEmpty(name))
                return false;
            string normalized = name.ToUpperInvariant();
            return normalized.Contains("VID_054C") &&
                (normalized.Contains("PID_0CE6") || normalized.Contains("PID_0DF2"));
        }

        private static string ReadDeviceName(IntPtr device)
        {
            uint characterCount = 0;
            uint firstResult = GetRawInputDeviceInfo(
                device,
                RIDI_DEVICENAME,
                null,
                ref characterCount);
            if (firstResult == UInt32.MaxValue || characterCount == 0)
                return String.Empty;

            StringBuilder name = new StringBuilder((int)characterCount);
            uint secondResult = GetRawInputDeviceInfo(
                device,
                RIDI_DEVICENAME,
                name,
                ref characterCount);
            return secondResult == UInt32.MaxValue ? String.Empty : name.ToString();
        }

        private static int CountConnectedDualSenseControllers()
        {
            uint count = 0;
            uint structureSize = (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICELIST));
            uint queryResult = GetRawInputDeviceList(IntPtr.Zero, ref count, structureSize);
            if (queryResult == UInt32.MaxValue || count == 0)
                return 0;

            IntPtr buffer = Marshal.AllocHGlobal((int)(count * structureSize));
            try
            {
                uint listedCount = count;
                uint result = GetRawInputDeviceList(buffer, ref listedCount, structureSize);
                if (result == UInt32.MaxValue)
                    return 0;

                int connected = 0;
                for (uint index = 0; index < listedCount; index++)
                {
                    IntPtr itemAddress = IntPtr.Add(buffer, (int)(index * structureSize));
                    RAWINPUTDEVICELIST item = (RAWINPUTDEVICELIST)Marshal.PtrToStructure(
                        itemAddress,
                        typeof(RAWINPUTDEVICELIST));
                    if (item.dwType == RIM_TYPEHID && IsDualSenseDeviceName(ReadDeviceName(item.hDevice)))
                        connected++;
                }
                return connected;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
    }
}
`

export function createDualSenseMonitorScript(holdMilliseconds: number): string {
  const safeHoldMilliseconds = Math.max(250, Math.min(120_000, Math.round(holdMilliseconds)))
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    "Add-Type -TypeDefinition @'",
    DUALSENSE_RAW_INPUT_SOURCE.trim(),
    "'@ -ReferencedAssemblies 'System.Windows.Forms.dll'",
    '',
    "if ($env:ORBIT_HARDWARE_MONITOR_SELF_TEST -eq '1') {",
    '  $usb = New-Object byte[] 64',
    '  $usb[0] = 0x01; $usb[10] = 0x01',
    '  $bluetooth = New-Object byte[] 78',
    '  $bluetooth[0] = 0x31; $bluetooth[11] = 0x01',
    '  $simple = New-Object byte[] 10',
    '  $simple[0] = 0x01; $simple[7] = 0x01',
    '  $released = New-Object byte[] 64',
    '  $released[0] = 0x01',
    '  $passed = [OrbitDualSenseRawInput]::IsPsButtonPressed($usb) -and',
    '    [OrbitDualSenseRawInput]::IsPsButtonPressed($bluetooth) -and',
    '    [OrbitDualSenseRawInput]::IsPsButtonPressed($simple) -and',
    '    -not [OrbitDualSenseRawInput]::IsPsButtonPressed($released)',
    '  if (-not $passed) { [Console]::Error.WriteLine("parser-self-test-failed"); exit 3 }',
    '  [Console]::WriteLine("self-test:ok")',
    '  exit 0',
    '}',
    '',
    `[bool]$started = [OrbitDualSenseRawInput]::Start(${safeHoldMilliseconds})`,
    'if (-not $started) {',
    '  [Console]::Error.WriteLine("raw-input-registration-failed:" + [OrbitDualSenseRawInput]::LastErrorCode)',
    '  [Console]::WriteLine("unavailable")',
    '  [Console]::Out.Flush()',
    '  exit 2',
    '}',
    "if ($env:ORBIT_HARDWARE_MONITOR_PROBE -eq '1') { Start-Sleep -Milliseconds 500; exit 0 }",
    'while ($true) { Start-Sleep -Seconds 1 }'
  ].join('\n')
}
