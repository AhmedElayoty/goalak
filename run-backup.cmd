@echo off
REM Goallak nightly backup. Snapshots every user's data and commits it.
REM Registered as the Windows scheduled task "Goallak backup".
cd /d "%~dp0"
node scripts-backup.mjs >> backups\backup.log 2>&1
git add backups >nul 2>&1
git -c user.email=ahmed.ayoty@capriole.ae -c user.name="Ahmed Elayoty" commit -q -m "backup: nightly snapshot" >nul 2>&1
git push -q origin HEAD >nul 2>&1
