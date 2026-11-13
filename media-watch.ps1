$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
        $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    if (-not $asTask) { throw 'Windows Runtime task bridge unavailable' }
    $task = $asTask.MakeGenericMethod($managerType).Invoke($null, @($managerType::RequestAsync()))
    $manager = $task.GetAwaiter().GetResult()
    while ($true) {
        $playing = $false
        foreach ($session in $manager.GetSessions()) {
            try {
                $info = $session.GetPlaybackInfo()
                $type = [string]$info.PlaybackType
                if ([string]$info.PlaybackStatus -eq 'Playing' -and
                    ($type -eq 'Music' -or $type -eq 'Unknown' -or [string]::IsNullOrEmpty($type))) {
                    $playing = $true
                    break
                }
            } catch { continue }
        }
        if ($playing) { [Console]::WriteLine('1') } else { [Console]::WriteLine('0') }
        Start-Sleep -Milliseconds 750
    }
} catch {
    [Console]::WriteLine('unavailable')
    exit 1
}
