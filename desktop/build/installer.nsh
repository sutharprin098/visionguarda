!macro customInit
  nsExec::Exec 'taskkill /F /IM "CamAI Desktop.exe" /T'
  nsExec::Exec 'taskkill /F /IM "camai-engine.exe" /T'
  nsExec::Exec 'taskkill /F /IM "electron.exe" /T'
  Sleep 1000
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "CamAI Desktop.exe" /T'
  nsExec::Exec 'taskkill /F /IM "camai-engine.exe" /T'
  nsExec::Exec 'taskkill /F /IM "electron.exe" /T'
  Sleep 1000
!macroend
