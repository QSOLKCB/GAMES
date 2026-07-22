HOST_CC ?= cc
WINDOWS_CC ?= x86_64-w64-mingw32-gcc

WARNINGS := -Wall -Wextra -Wpedantic -Wshadow -Wconversion
COMMON_CFLAGS := -std=c99 -Os -ffunction-sections -fdata-sections -fno-ident -Isrc
HOST_CFLAGS ?= $(COMMON_CFLAGS) $(WARNINGS)
WINDOWS_CFLAGS ?= $(COMMON_CFLAGS) -DNDEBUG -D_WIN32_WINNT=0x0601 \
	-fno-asynchronous-unwind-tables -fno-unwind-tables
WINDOWS_LDFLAGS ?= -mwindows -s -Wl,--gc-sections -Wl,--subsystem,windows \
	-lgdi32 -lwinmm

CORE_SOURCES := src/td_game.c src/td_audio.c
TEST_BINARY := build/td_tests
WINDOWS_BINARY := build/TERNARY.EXE

.PHONY: all test windows package size clean

all: test

build:
	mkdir -p build

$(TEST_BINARY): $(CORE_SOURCES) tests/test_determinism.c | build
	$(HOST_CC) $(HOST_CFLAGS) $^ -o $@

test: $(TEST_BINARY)
	./$(TEST_BINARY)

$(WINDOWS_BINARY): $(CORE_SOURCES) src/td_win32.c | build
	$(WINDOWS_CC) $(WINDOWS_CFLAGS) $^ -o $@ $(WINDOWS_LDFLAGS)

windows: $(WINDOWS_BINARY)

size: $(WINDOWS_BINARY)
	python3 tools/verify_size.py $(WINDOWS_BINARY) README.TXT

package: size
	mkdir -p build/package
	cp $(WINDOWS_BINARY) build/package/TERNARY.EXE
	cp README.TXT build/package/README.TXT

clean:
	rm -rf build
