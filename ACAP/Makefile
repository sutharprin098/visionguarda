# Makefile for CamAI ACAP Native Application
# Targets:
#   make                      - Build release ACAP executable / package
#   make ENABLE_ACAP_NATIVE=1 - Build with Larod + VDO (requires ACAP SDK env)
#   make WITH_OPENCV=1        - Link OpenCV (for MicroMotion optical flow)
#   make test                 - Build and run local unit test suite
#   make benchmark            - Build and run performance profiling runner
#   make clean                - Remove build artifacts

PROG1 = camai_acap

# ─── Object files ────────────────────────────────────────────────────────────
OBJS  = app/main.o \
        app/camai_engine.o \
        app/video_pipeline.o \
        app/inference.o \
        app/tracking.o \
        app/events.o \
        app/overlay.o \
        app/config.o \
        app/diagnostics.o \
        modules/security/security_module.o

# preprocessor.hpp is header-only (inline functions); no .cpp to compile.
# micro_motion_module.hpp is also header-only.

TEST_OBJS = tests/test_main.o \
            tests/test_pipeline.o \
            tests/test_tracking.o \
            tests/test_roi.o \
            tests/test_events.o \
            app/tracking.o \
            app/events.o \
            app/config.o \
            app/diagnostics.o \
            modules/security/security_module.o

BENCH_OBJS = benchmarks/benchmark_runner.o \
             app/tracking.o \
             app/diagnostics.o \
             modules/security/security_module.o

# ─── Compiler settings ───────────────────────────────────────────────────────
CXX      ?= g++
CXXFLAGS += -std=c++17 -O3 -Wall -Wextra -pthread -I. -Iapp -Imodules

# ─── ACAP SDK / Larod / VDO ──────────────────────────────────────────────────
# Build with ENABLE_ACAP_NATIVE=1 inside the ACAP SDK Docker container:
#   docker run --rm -v $(pwd):/workspace axisecp/acap-native-sdk \
#       make ENABLE_ACAP_NATIVE=1 WITH_OPENCV=1
ifeq ($(ENABLE_ACAP_NATIVE),1)
    CXXFLAGS += -DACAP_NATIVE_BUILD=1
    LIBS     += -lvdo -llarod -laxevent -laxoverlay -laxparameter
else
    CXXFLAGS += -DACAP_NATIVE_BUILD=0
endif

# ─── OpenCV (for MicroMotion optical flow) ───────────────────────────────────
# On ACAP hardware the SDK provides libopencv via:
#   ACAP_SDK_ROOT = /opt/axis/acapsdk
#   $(ACAP_SDK_ROOT)/sysroots/aarch64-poky-linux/usr/lib/libopencv_*.so
# In dev/CI: link the host OpenCV via pkg-config.
ifeq ($(WITH_OPENCV),1)
    # Host / CI build
    OPENCV_CFLAGS := $(shell pkg-config --cflags opencv4 2>/dev/null || pkg-config --cflags opencv 2>/dev/null)
    OPENCV_LIBS   := $(shell pkg-config --libs   opencv4 2>/dev/null || pkg-config --libs   opencv 2>/dev/null)
    CXXFLAGS      += $(OPENCV_CFLAGS)
    LIBS          += $(OPENCV_LIBS)
else
    # No OpenCV — disable at compile time. MicroMotion silently idles.
    CXXFLAGS += -DCAMAI_NO_OPENCV=1 -DMICRO_MOTION_OPENCV=0
endif

LDFLAGS  += -pthread

# ─── Targets ─────────────────────────────────────────────────────────────────
all: $(PROG1)

$(PROG1): $(OBJS)
	$(CXX) $(LDFLAGS) -o $@ $(OBJS) $(LIBS)

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

test: $(TEST_OBJS)
	$(CXX) $(LDFLAGS) -o run_tests $(TEST_OBJS)
	./run_tests

benchmark: $(BENCH_OBJS)
	$(CXX) $(LDFLAGS) -o run_benchmark $(BENCH_OBJS)
	./run_benchmark

clean:
	rm -f $(OBJS) $(TEST_OBJS) $(BENCH_OBJS) $(PROG1) run_tests run_benchmark *.eap

# ─── ACAP package (.eap) ─────────────────────────────────────────────────────
# Requires ACAP SDK:  https://hub.docker.com/r/axisecp/acap-native-sdk
#   docker run --rm -v $(pwd):/workspace axisecp/acap-native-sdk \
#       /opt/axis/acapsdk/environment-setup-aarch64-poky-linux \
#       && make ENABLE_ACAP_NATIVE=1 WITH_OPENCV=1 eap
eap: $(PROG1)
	@echo "Building .eap package..."
	$(if $(wildcard /opt/axis/acapsdk/scripts/acap_build),\
	    /opt/axis/acapsdk/scripts/acap_build,\
	    eap-create)
	@echo "Done. Install the .eap file via the camera's Application page."

.PHONY: all test benchmark clean eap
