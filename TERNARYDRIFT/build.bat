@echo off
setlocal

if not exist build mkdir build

where x86_64-w64-mingw32-gcc >nul 2>nul
if %errorlevel%==0 set CC=x86_64-w64-mingw32-gcc

if not defined CC (
  where gcc >nul 2>nul
  if %errorlevel%==0 set CC=gcc
)

if not defined CC (
  echo ERROR: A MinGW-w64 C compiler is required.
  exit /b 1
)

%CC% -std=c99 -Os -DNDEBUG -D_WIN32_WINNT=0x0601 -ffunction-sections -fdata-sections -fno-ident -fno-asynchronous-unwind-tables -Isrc src\td_game.c src\td_audio.c src\td_win32.c -o build\TERNARY.EXE -mwindows -s -Wl,--gc-sections -Wl,--subsystem,windows -lgdi32 -lwinmm
if errorlevel 1 exit /b 1

where python >nul 2>nul
if %errorlevel%==0 (
  python tools\verify_size.py build\TERNARY.EXE README.TXT
) else (
  echo WARNING: Python not found; package-size verification was skipped.
)

echo Built build\TERNARY.EXE
endlocal
