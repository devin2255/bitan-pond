# Exercise desktop hit-testing and hidden-icon handling with isolated windows.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\desk-input.cs'))
function ReplaceRequired([string]$from, [string]$to) {
  if (-not $script:source.Contains($from)) { throw 'Missing input test injection point' }
  $script:source = $script:source.Replace($from, $to)
}
ReplaceRequired 'internal static class DeskInput {' @'
public static class DeskInput {
  public static IntPtr TestRoot, TestDef, TestLeaf, TestList;
  public static bool TestOnDesktop(IntPtr h) { return OnDesktop(h); }
  public static int TestRefreshIcons() { RefreshIcons(); return icons.Length; }
'@
ReplaceRequired 'static string ClassOf(IntPtr hwnd) {' @'
static string ClassOf(IntPtr hwnd) {
    if (hwnd == TestRoot && hwnd != IntPtr.Zero) return "Progman";
    if (hwnd == TestDef && hwnd != IntPtr.Zero) return "SHELLDLL_DefView";
    if (hwnd == TestLeaf && hwnd != IntPtr.Zero) return "DirectUIHWND";
'@
ReplaceRequired 'static IntPtr FindListView() {' 'static IntPtr FindListView() { if (TestList != IntPtr.Zero) return TestList;'
Add-Type -TypeDefinition $source
$hostForm = New-Object System.Windows.Forms.Form
$other = New-Object System.Windows.Forms.Form
try {
  $hostForm.StartPosition = 'Manual'; $hostForm.Location = New-Object System.Drawing.Point(-6000, -4000)
  $hostForm.ClientSize = New-Object System.Drawing.Size(800, 600); $hostForm.ShowInTaskbar = $false
  $panel = New-Object System.Windows.Forms.Panel
  $panel.Size = New-Object System.Drawing.Size(500, 450)
  $leaf = New-Object System.Windows.Forms.Button
  $leaf.Location = New-Object System.Drawing.Point(20, 20)
  $panel.Controls.Add($leaf)
  $list = New-Object System.Windows.Forms.ListView
  $list.Location = New-Object System.Drawing.Point(20, 80); $list.Size = New-Object System.Drawing.Size(300, 220)
  [void]$list.Items.Add('Item one'); [void]$list.Items.Add('Item two')
  $panel.Controls.Add($list); $hostForm.Controls.Add($panel)
  $other.StartPosition = 'Manual'; $other.Location = New-Object System.Drawing.Point(-7000, -5000); $other.ShowInTaskbar = $false
  $hostForm.Show(); $other.Show(); [System.Windows.Forms.Application]::DoEvents()
  [DeskInput]::TestRoot = $hostForm.Handle; [DeskInput]::TestDef = $panel.Handle; [DeskInput]::TestLeaf = $leaf.Handle
  if (-not [DeskInput]::TestOnDesktop($leaf.Handle)) { throw 'Nested Windows 11 desktop control was rejected' }
  if ([DeskInput]::TestOnDesktop($other.Handle)) { throw 'Unrelated application was treated as desktop' }
  [DeskInput]::TestList = $list.Handle
  if ([DeskInput]::TestRefreshIcons() -lt 1) { throw 'Visible icon rectangles were not detected' }
  $list.Hide(); [System.Windows.Forms.Application]::DoEvents()
  if ([DeskInput]::TestRefreshIcons() -ne 0) { throw 'Hidden icons still block clicks' }
  Write-Output 'OK input routing: nested desktop controls, unrelated windows, hidden icons'
} finally { $other.Dispose(); $hostForm.Dispose() }
