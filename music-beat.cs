// Reads short-lived audio levels from the default render device via WASAPI
// loopback. Samples stay in memory; only two level numbers leave this process.
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Diagnostics;

internal static class MusicBeatCapture
{
    private const int CLSCTX_ALL = 23;
    private const uint LOOPBACK = 0x00020000;
    private const uint SILENT = 0x00000002;

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsctx, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
        [PreserveSig] int GetId(out IntPtr id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint flags, long duration, long periodicity, IntPtr format, IntPtr session);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormat
    {
        public ushort tag, channels;
        public uint sampleRate, bytesPerSecond;
        public ushort blockAlign, bitsPerSample, extraSize;
    }

    private static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }
    private static void Release(object obj) { if (obj != null && Marshal.IsComObject(obj)) Marshal.FinalReleaseComObject(obj); }

    private static double ReadSample(byte[] b, int i, int bits, bool floating)
    {
        if (floating && bits == 32) {
            float value = BitConverter.ToSingle(b, i);
            return float.IsNaN(value) || float.IsInfinity(value) ? 0 : Math.Max(-1, Math.Min(1, value));
        }
        if (bits == 16) return BitConverter.ToInt16(b, i) / 32768.0;
        if (bits == 24) {
            int value = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
            if ((value & 0x800000) != 0) value |= unchecked((int)0xff000000);
            return value / 8388608.0;
        }
        if (bits == 32) return BitConverter.ToInt32(b, i) / 2147483648.0;
        return 0;
    }

    private static int Main(string[] args)
    {
        object enumeratorObject = null, audioObject = null, captureObject = null;
        IMMDevice device = null;
        IAudioClient audio = null;
        Process parent = null;
        IntPtr formatPointer = IntPtr.Zero;
        try {
            int parentId;
            if (args.Length > 0 && int.TryParse(args[0], out parentId)) parent = Process.GetProcessById(parentId);
            Type enumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
            enumeratorObject = Activator.CreateInstance(enumeratorType);
            var enumerator = (IMMDeviceEnumerator)enumeratorObject;
            Check(enumerator.GetDefaultAudioEndpoint(0, 1, out device)); // eRender, eMultimedia
            Guid audioId = typeof(IAudioClient).GUID;
            Check(device.Activate(ref audioId, CLSCTX_ALL, IntPtr.Zero, out audioObject));
            audio = (IAudioClient)audioObject;
            Check(audio.GetMixFormat(out formatPointer));
            var format = (WaveFormat)Marshal.PtrToStructure(formatPointer, typeof(WaveFormat));
            Guid subtype = format.tag == 0xfffe ? (Guid)Marshal.PtrToStructure(IntPtr.Add(formatPointer, 24), typeof(Guid)) : Guid.Empty;
            bool floating = format.tag == 3 || (format.tag == 0xfffe && subtype == new Guid("00000003-0000-0010-8000-00aa00389b71"));
            bool pcm = format.tag == 1 || (format.tag == 0xfffe && subtype == new Guid("00000001-0000-0010-8000-00aa00389b71"));
            if ((!floating && !pcm) || format.channels == 0 || format.blockAlign == 0 ||
                (format.bitsPerSample != 16 && format.bitsPerSample != 24 && format.bitsPerSample != 32)) throw new InvalidOperationException("Unsupported render format");
            Check(audio.Initialize(0, LOOPBACK, 10000000, 0, formatPointer, IntPtr.Zero));
            Guid captureId = typeof(IAudioCaptureClient).GUID;
            Check(audio.GetService(ref captureId, out captureObject));
            var capture = (IAudioCaptureClient)captureObject;
            Check(audio.Start());
            var clock = Stopwatch.StartNew();
            long lastOutput = 0, lastParentCheck = 0;
            double fullSum = 0, lowSum = 0, low = 0;
            int samples = 0, stride = 4, bytesPerSample = format.bitsPerSample / 8;
            double lowAlpha = 1 - Math.Exp(-2 * Math.PI * 160 * stride / format.sampleRate);
            int window = Math.Max(1, (int)format.sampleRate / stride / 20);
            while (true) {
                if (parent != null && clock.ElapsedMilliseconds - lastParentCheck >= 2000) {
                    if (parent.HasExited) break;
                    lastParentCheck = clock.ElapsedMilliseconds;
                }
                uint packet;
                Check(capture.GetNextPacketSize(out packet));
                while (packet > 0) {
                    IntPtr data; uint frames, flags; ulong devicePosition, qpcPosition;
                    Check(capture.GetBuffer(out data, out frames, out flags, out devicePosition, out qpcPosition));
                    try {
                        int byteCount = checked((int)frames * format.blockAlign);
                        var bytes = new byte[byteCount];
                        if ((flags & SILENT) == 0 && data != IntPtr.Zero) Marshal.Copy(data, bytes, 0, byteCount);
                        for (int frame = 0; frame < frames; frame += stride) {
                            int i = frame * format.blockAlign;
                            double value = ReadSample(bytes, i, format.bitsPerSample, floating);
                            if (format.channels > 1) {
                                double second = ReadSample(bytes, i + bytesPerSample, format.bitsPerSample, floating);
                                if (Math.Abs(second) > Math.Abs(value)) value = second;
                            }
                            low += lowAlpha * (value - low);
                            fullSum += value * value; lowSum += low * low; samples++;
                            if (samples >= window) {
                                long sampleTime = (flags & 4) != 0 ? Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency :
                                    (long)(qpcPosition / 10000) + (long)frame * 1000 / format.sampleRate;
                                Console.WriteLine("{0} {1} {2}", sampleTime,
                                    Math.Sqrt(fullSum / samples).ToString("F7", CultureInfo.InvariantCulture),
                                    Math.Sqrt(lowSum / samples).ToString("F7", CultureInfo.InvariantCulture));
                                fullSum = 0; lowSum = 0; samples = 0; lastOutput = clock.ElapsedMilliseconds;
                            }
                        }
                    } finally { Check(capture.ReleaseBuffer(frames)); }
                    Check(capture.GetNextPacketSize(out packet));
                }
                if (clock.ElapsedMilliseconds - lastOutput > 100) {
                    Console.WriteLine("{0} 0 0", Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency); lastOutput = clock.ElapsedMilliseconds;
                }
                Thread.Sleep(20);
            }
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.Message);
            return 1;
        } finally {
            if (audio != null) audio.Stop();
            if (formatPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(formatPointer);
            Release(captureObject); Release(audioObject); Release(device); Release(enumeratorObject);
            if (parent != null) parent.Dispose();
        }
    }
}
