const { exec } = require("child_process");
const { log } = require("./logger");

/**
 * Gets the bounding boxes of all visible top-level windows on Windows.
 * Uses PowerShell to call Win32 APIs (EnumWindows, GetWindowRect, IsWindowVisible).
 * Returns an array of { title, x, y, width, height }
 */
async function getVisibleWindowBounds() {
    return new Promise((resolve) => {
        // Only works on Windows. For other OS platforms, we'd need different scripts.
        if (process.platform !== "win32") {
            log("warn", "getVisibleWindowBounds: Only supported on Windows");
            return resolve([]);
        }

        const psCommand = `
      Add-Type -TypeDefinition '
      using System;
      using System.Runtime.InteropServices;
      using System.Collections.Generic;
      using System.Text;

      public class WindowGetter {
          [DllImport(\"user32.dll\")]
          public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
          [DllImport(\"user32.dll\")]
          public static extern bool IsWindowVisible(IntPtr hWnd);
          [DllImport(\"user32.dll\")]
          public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
          [DllImport(\"user32.dll\")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

          [StructLayout(LayoutKind.Sequential)]
          public struct RECT {
              public int Left; public int Top; public int Right; public int Bottom;
          }

          public static List<object> GetWindows() {
              var list = new List<object>();
              EnumWindows((hWnd, lParam) => {
                  if (IsWindowVisible(hWnd)) {
                      var sb = new StringBuilder(256);
                      GetWindowText(hWnd, sb, 256);
                      string title = sb.ToString();

                      if (!string.IsNullOrEmpty(title) && 
                          title != \"Program Manager\" && 
                          title != \"Start\" && 
                          title != \"Taskbar\") {
                          
                          RECT rect;
                          if (GetWindowRect(hWnd, out rect)) {
                            if (rect.Right > rect.Left && rect.Bottom > rect.Top) {
                              list.Add(new {
                                  Title = title,
                                  X = rect.Left, Y = rect.Top,
                                  W = rect.Right - rect.Left, H = rect.Bottom - rect.Top
                              });
                            }
                          }
                      }
                  }
                  return true;
              }, IntPtr.Zero);
              return list;
          }
      }';
      [WindowGetter]::GetWindows() | ConvertTo-Json -Compress
    `;

        const cmd = `powershell -NoProfile -Command "${psCommand.replace(/\n/g, " ").replace(/"/g, '\\"')}"`;

        exec(cmd, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                log("error", `Failed to get window bounds via PowerShell: ${error.message}`);
                return resolve([]);
            }

            try {
                const data = JSON.parse(stdout);
                // PowerShell might return a single object or an array
                const windows = Array.isArray(data) ? data : (data ? [data] : []);

                // Clean up keys to lowercase for JS consistency
                const processed = windows.map(w => ({
                    title: w.Title,
                    x: w.X,
                    y: w.Y,
                    width: w.W,
                    height: w.H
                }));

                console.log(`[WINDOWS-DETECTION] Detected ${processed.length} visible windows`);
                log("info", `Detected ${processed.length} visible windows for snapping`);
                resolve(processed);
            } catch (parseErr) {
                // Output might be empty or malformed if no windows found
                resolve([]);
            }
        });
    });
}

module.exports = { getVisibleWindowBounds };
