' Starts the touch panel with no console window.
' Put a shortcut to this file in shell:startup to launch it at login.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c npx electron .", 0, False
