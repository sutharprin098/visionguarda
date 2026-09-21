# Makefile for CamAI ACAP Native Application
# Targets:
#   make          - Build release ACAP executable / package
#   make test     - Build and run local unit test suite
#   make benchmark- Build and run performance profiling runner
#   make clean    - Remove build artifacts

PROG1 = camai_acap
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

CXX ?= g++
CXXFLAGS += -std=c++17 -O3 -Wall -Wextra -pthread -I. -Iapp -Imodules
LDFLAGS  += -pthread

# AXIS ACAP Native Libraries (linked in ACAP SDK environment)
# -lvdo -llarod -laxevent -laxoverlay -laxparameter
# Conditional mock flags for local development builds
ifeq ($(ENABLE_ACAP_NATIVE),1)
    CXXFLAGS += -DACAP_NATIVE_BUILD=1
    LIBS     += -lvdo -llarod -laxevent -laxoverlay -laxparameter
else
    CXXFLAGS += -DACAP_NATIVE_BUILD=0
endif

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
