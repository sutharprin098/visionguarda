using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class Wrap7za
{
    static int Main(string[] args)
    {
        string dir = Path.GetDirectoryName(typeof(Wrap7za).Assembly.Location);
        string realPath = Path.Combine(dir, "7za_real.exe");
        if (!File.Exists(realPath))
        {
            realPath = @"D:\camAI\desktop\node_modules\7zip-bin\win\x64\7za_real.exe";
        }

        var sb = new StringBuilder();
        bool isExtract = args.Length > 0 && (args[0] == "x" || args[0] == "e");
        foreach (var a in args)
        {
            string token = a;
            if (token.StartsWith("-mx="))
            {
                token = "-mx=3 -md=32m -mmt=2";
            }
            if (sb.Length > 0) sb.Append(' ');
            if (token.Contains(" ") && !token.StartsWith("-mx="))
                sb.Append('"').Append(token).Append('"');
            else
                sb.Append(token);
        }
        if (isExtract) sb.Append(" -snl-");

        var psi = new ProcessStartInfo(realPath, sb.ToString())
        {
            UseShellExecute = false
        };
        using (var p = Process.Start(psi))
        {
            p.WaitForExit();
            return p.ExitCode;
        }
    }
}
