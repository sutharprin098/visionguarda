using System;
using System.Diagnostics;
using System.Text;

// Wrapper resolved via USE_SYSTEM_7ZA=true + PATH (see 7zip-bin/index.js),
// so the real, unmodified vendored binary in node_modules is never touched.
// Only purpose: append -snl- on extraction so 7-Zip writes plain files
// instead of true OS symlinks, avoiding SeCreateSymbolicLinkPrivilege.
class Wrap7za
{
    const string RealPath = @"D:\camAI\desktop\node_modules\7zip-bin\win\x64\7za.exe";

    static int Main(string[] args)
    {
        var sb = new StringBuilder();
        bool isExtract = args.Length > 0 && (args[0] == "x" || args[0] == "e");
        foreach (var a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (a.Contains(" "))
                sb.Append('"').Append(a).Append('"');
            else
                sb.Append(a);
        }
        if (isExtract) sb.Append(" -snl-");

        var psi = new ProcessStartInfo(RealPath, sb.ToString()) { UseShellExecute = false };
        using (var p = Process.Start(psi))
        {
            p.WaitForExit();
            return p.ExitCode;
        }
    }
}
