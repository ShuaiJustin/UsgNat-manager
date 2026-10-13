param(
    [Parameter(Mandatory=$true)][ValidateSet('read','write','delete-test')][string]$Operation,
    [Parameter(Mandatory=$true)][string]$Target
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    if ($Target -notmatch '^USG-NAT-Manager/update-signing/(key|backup-password|test)/[a-zA-Z0-9_-]{16,80}$') { throw 'Invalid target' }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
public static class UsgSigningCredentials {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct Credential {
        public uint Flags, Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
    }
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredReadW(string target, uint type, uint flags, out IntPtr pointer);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredWriteW(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredDeleteW(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr pointer);
    public static byte[] Read(string target) {
        IntPtr pointer;
        if (!CredReadW(target, 1, 0, out pointer)) {
            if (Marshal.GetLastWin32Error() == 1168) return null;
            throw new InvalidOperationException("Credential read failed");
        }
        try {
            var c = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            if (c.Type != 1 || c.CredentialBlobSize > 2048) throw new InvalidOperationException("Invalid credential");
            var data = new byte[c.CredentialBlobSize];
            Marshal.Copy(c.CredentialBlob, data, 0, data.Length);
            return data;
        } finally { CredFree(pointer); }
    }
    public static void WriteNew(string target, byte[] data) {
        // Generic credentials replace existing values. Serialize the check and write
        // across sessions for the same Windows user and case-insensitive target.
        string name;
        using (var hash = SHA256.Create()) {
            var identity = WindowsIdentity.GetCurrent().User.Value + "\n" + target.ToUpperInvariant();
            name = "Global\\USGSigning_" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-", "");
        }
        using (var mutex = new Mutex(false, name)) {
            bool acquired = false;
            try {
                try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(15)); }
                catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new InvalidOperationException("Credential write busy");
                WriteNewLocked(target, data);
            } finally { if (acquired) mutex.ReleaseMutex(); }
        }
    }
    private static void WriteNewLocked(string target, byte[] data) {
        var existing = Read(target);
        if (existing != null) { Array.Clear(existing, 0, existing.Length); throw new InvalidOperationException("Credential exists"); }
        if (data.Length == 0 || data.Length > 2048) throw new InvalidOperationException("Invalid credential size");
        var pointer = Marshal.AllocHGlobal(data.Length);
        try {
            Marshal.Copy(data, 0, pointer, data.Length);
            var c = new Credential { Type=1, TargetName=target, UserName="USG release signing", CredentialBlobSize=(uint)data.Length, CredentialBlob=pointer, Persist=2 };
            if (!CredWriteW(ref c, 0)) throw new InvalidOperationException("Credential write failed");
        } finally { Marshal.Copy(new byte[data.Length], 0, pointer, data.Length); Marshal.FreeHGlobal(pointer); }
    }
}
'@ | Out-Null
    if ($Operation -eq 'read') {
        $bytes = [UsgSigningCredentials]::Read($Target)
        try {
            if ($null -eq $bytes) { [Console]::Write('{"found":false}') }
            else { [Console]::Write((@{ found=$true; value=[Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress)) }
        } finally { if ($null -ne $bytes) { [Array]::Clear($bytes,0,$bytes.Length) } }
    } elseif ($Operation -eq 'write') {
        $inputValue = ([Console]::In.ReadToEnd() | ConvertFrom-Json).value
        if ($inputValue -isnot [string]) { throw 'Invalid input' }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($inputValue)
        try { [UsgSigningCredentials]::WriteNew($Target,$bytes) }
        finally { [Array]::Clear($bytes,0,$bytes.Length) }
        [Console]::Write('{"written":true}')
    } else {
        if ($Target -notmatch '^USG-NAT-Manager/update-signing/test/[a-zA-Z0-9_-]{16,80}$') { throw 'Only test targets may be deleted' }
        if (-not [UsgSigningCredentials]::CredDeleteW($Target,1,0) -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { throw 'Delete failed' }
        [Console]::Write('{"deleted":true}')
    }
} catch {
    [Console]::Error.Write('Signing credential operation failed')
    exit 1
}
